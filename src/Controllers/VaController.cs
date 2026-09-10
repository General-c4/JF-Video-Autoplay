using System.Reflection;
using System.Text.Json;
using Jellyfin.Plugin.VideoAutoplay.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.VideoAutoplay.Controllers;

[ApiController]
[Route("VideoAutoplay")]
public sealed class VaController : ControllerBase
{
    private readonly ILogger<VaController> _logger;
    private readonly YtDlpService _ytDlpService = new();

    public VaController(ILogger<VaController> logger) => _logger = logger;

    [AllowAnonymous]
    [HttpGet("config.js")]
    public IActionResult ConfigJs()
    {
        try
        {
            var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
            var clientConfiguration = new
            {
                enabled = cfg.Enabled,
                uiLanguage = string.IsNullOrWhiteSpace(cfg.UiLanguage) ? "ar" : cfg.UiLanguage,
                maxItems = cfg.MaxItemsPerType,
                preferRemoteTrailers = cfg.PreferRemoteTrailers,
                autoplayMuted = cfg.AutoplayMuted,
                basePath = GetBasePath(),
                altTitles = cfg.AltTitles ?? Array.Empty<string>(),
                enableYtDirect = cfg.EnableYtDirect,
                ytDlpAvailable = Path.IsPathFullyQualified(cfg.YtDlpPath ?? string.Empty) && System.IO.File.Exists(cfg.YtDlpPath),
                ytPreferMp4 = cfg.YtPreferMp4,
                ytForceFormat18 = cfg.YtForceFormat18,
                version = Plugin.ToolVersion
            };

            var javascript = "window.JF_VA_CONFIG=" + JsonSerializer.Serialize(clientConfiguration) + ";";
            Response.Headers.CacheControl = "no-store, max-age=0";
            return Content(javascript, "application/javascript; charset=utf-8");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[VA] Failed to build client configuration");
            return Content("window.JF_VA_CONFIG={enabled:false,error:'config_failed'};", "application/javascript; charset=utf-8");
        }
    }

    [AllowAnonymous]
    [HttpGet("loader.js")]
    public IActionResult Loader() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.loader.js");

    [AllowAnonymous]
    [HttpGet("config.json")]
    public IActionResult ConfigJson()
    {
        var result = (ContentResult)ConfigJs();
        var content = result.Content ?? string.Empty;
        const string prefix = "window.JF_VA_CONFIG=";
        if (!content.StartsWith(prefix, StringComparison.Ordinal)) return StatusCode(503);
        try
        {
            using var json = JsonDocument.Parse(content[prefix.Length..].TrimEnd(';'));
            return new JsonResult(json.RootElement.Clone());
        }
        catch (JsonException) { return StatusCode(503); }
    }

    [AllowAnonymous]
    [HttpGet("media-cache.js")]
    public IActionResult MediaCacheJs() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.media-cache.js");

    [AllowAnonymous]
    [HttpGet("runtime.js")]
    public IActionResult RuntimeJs() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.runtime.js");

    [AllowAnonymous]
    [HttpGet("admin-response.js")]
    public IActionResult AdminResponseJs() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.admin-response.js");

    [AllowAnonymous]
    [HttpGet("video-autoplay.js")]
    public IActionResult MainJs() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.video-autoplay.js");

    [AllowAnonymous]
    [HttpGet("hls.min.js")]
    public IActionResult HlsJs() => EmbeddedFile("Jellyfin.Plugin.VideoAutoplay.Web.vendor.hls.min.js");

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpGet("yt-direct")]
    public async Task<IActionResult> YtDirect([FromQuery] string u, [FromQuery] string? mode, CancellationToken cancellationToken)
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        if (!cfg.EnableYtDirect)
        {
            return BadRequest(new { ok = false, error = "disabled" });
        }

        var result = await _ytDlpService.ResolveAsync(
            cfg.YtDlpPath ?? string.Empty,
            u,
            mode,
            cfg.YtPreferMp4,
            cfg.YtForceFormat18,
            cancellationToken).ConfigureAwait(false);

        if (!result.Success)
        {
            var status = result.Error switch
            {
                "busy" => StatusCodes.Status429TooManyRequests,
                "timeout" => StatusCodes.Status504GatewayTimeout,
                "cancelled" => StatusCodes.Status408RequestTimeout,
                "invalid_url" or "invalid_executable" => StatusCodes.Status400BadRequest,
                _ => StatusCodes.Status502BadGateway
            };
            return StatusCode(status, new { ok = false, error = result.Error });
        }

        return Ok(new { ok = true, url = result.Url, ext = result.Extension, protocol = result.Protocol, isHls = result.IsHls });
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpGet("info")]
    public IActionResult Info()
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var discovery = GetDiscoveryService().Discover(cfg.IndexHtmlPath, GetVersionedLoaderPath());
        return Ok(new
        {
            basePath = GetBasePath(),
            resolvedWebPath = discovery.WebRootPath,
            configuredIndexHtmlPath = cfg.IndexHtmlPath ?? string.Empty,
            indexHtml = discovery.IndexHtmlPath,
            exists = discovery.Exists,
            discovery,
            version = Plugin.ToolVersion,
            developer = "General-c4"
        });
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpGet("discover")]
    public IActionResult Discover()
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var result = GetDiscoveryService().Discover(cfg.IndexHtmlPath, GetVersionedLoaderPath());
        if (result.Success)
        {
            SaveDiscoveredPath(result);
        }

        return DiscoveryResponse(result);
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpGet("probe")]
    public async Task<IActionResult> Probe(CancellationToken cancellationToken)
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var discovery = GetDiscoveryService().Discover(cfg.IndexHtmlPath, GetVersionedLoaderPath());
        if (!discovery.Success)
        {
            return DiscoveryResponse(discovery);
        }

        try
        {
            SaveDiscoveredPath(discovery);
            var html = await System.IO.File.ReadAllTextAsync(discovery.IndexHtmlPath, cancellationToken).ConfigureAwait(false);
            var loaderPath = GetVersionedLoaderPath();
            return Ok(new
            {
                ok = true,
                injected = IndexFileService.ContainsLoader(html, loaderPath),
                legacyTagPresent = html.Contains(IndexFileService.Marker, StringComparison.OrdinalIgnoreCase)
                    && !IndexFileService.ContainsLoader(html, loaderPath),
                discovery
            });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogError(ex, "[VA] Probe failed");
            return StatusCode(StatusCodes.Status500InternalServerError, new { ok = false, error = "read_failed" });
        }
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("inject-now")]
    public async Task<IActionResult> InjectNow(CancellationToken cancellationToken)
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var loaderPath = GetVersionedLoaderPath();
        var automatic = await new JellyfinWebInjectionService(GetDiscoveryService())
            .InjectAsync(cfg.IndexHtmlPath, loaderPath, SaveDiscoveredPath, cancellationToken)
            .ConfigureAwait(false);
        if (!automatic.Discovery.Success)
        {
            return DiscoveryResponse(automatic.Discovery);
        }

        return MutationResponse(automatic.Mutation!);
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("auto-inject")]
    public Task<IActionResult> AutoInject(CancellationToken cancellationToken) => InjectNow(cancellationToken);

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("remove-now")]
    public async Task<IActionResult> RemoveNow(CancellationToken cancellationToken)
    {
        var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var discovery = GetDiscoveryService().Discover(cfg.IndexHtmlPath, GetVersionedLoaderPath());
        if (!discovery.Success)
        {
            return DiscoveryResponse(discovery);
        }

        var service = new IndexFileService(discovery.WebRootPath);
        var result = await service.RemoveAsync(discovery.IndexHtmlPath, cancellationToken).ConfigureAwait(false);
        return MutationResponse(result);
    }

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpGet("conf")]
    public IActionResult GetConf() => Ok(Plugin.Instance?.Configuration ?? new PluginConfiguration());

    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("conf")]
    public IActionResult SaveConf([FromBody] PluginConfiguration posted)
    {
        if (Plugin.Instance is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { ok = false, error = "plugin_not_ready" });
        }

        if (!string.IsNullOrWhiteSpace(posted.IndexHtmlPath))
        {
            var validation = GetDiscoveryService().ValidateConfigured(posted.IndexHtmlPath, GetVersionedLoaderPath());
            if (!validation.Success)
            {
                return DiscoveryResponse(validation);
            }
        }

        if (posted.EnableYtDirect
            && (string.IsNullOrWhiteSpace(posted.YtDlpPath)
                || !Path.IsPathFullyQualified(posted.YtDlpPath)
                || !System.IO.File.Exists(posted.YtDlpPath)))
        {
            return BadRequest(new { ok = false, error = "invalid_yt_dlp_path" });
        }

        var cfg = Plugin.Instance.Configuration ?? new PluginConfiguration();
        cfg.UiLanguage = posted.UiLanguage is "en" ? "en" : "ar";
        cfg.Enabled = posted.Enabled;
        cfg.MaxItemsPerType = Math.Clamp(posted.MaxItemsPerType <= 0 ? 5 : posted.MaxItemsPerType, 1, 10);
        cfg.PreferRemoteTrailers = posted.PreferRemoteTrailers;
        cfg.AutoplayMuted = posted.AutoplayMuted;
        cfg.IndexHtmlPath = string.IsNullOrWhiteSpace(posted.IndexHtmlPath) ? string.Empty : Path.GetFullPath(posted.IndexHtmlPath);
        cfg.EnableYtDirect = posted.EnableYtDirect;
        cfg.YtDlpPath = string.IsNullOrWhiteSpace(posted.YtDlpPath) ? string.Empty : Path.GetFullPath(posted.YtDlpPath);
        cfg.YtPreferMp4 = posted.YtPreferMp4;
        cfg.YtForceFormat18 = posted.YtForceFormat18;

        try
        {
            Plugin.Instance.UpdateConfiguration(cfg);
            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[VA] UpdateConfiguration failed");
            return StatusCode(StatusCodes.Status500InternalServerError, new { ok = false, error = "update_failed" });
        }
    }

    private string GetBasePath()
    {
        var pathBase = HttpContext.Request.PathBase.ToString();
        return string.IsNullOrEmpty(pathBase) ? string.Empty : pathBase;
    }

    private string GetVersionedLoaderPath()
        => $"{GetBasePath()}/VideoAutoplay/loader.js?v={Uri.EscapeDataString(Plugin.ToolVersion)}";

    private IActionResult EmbeddedFile(string name)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(name);
        if (stream is null)
        {
            return NotFound();
        }

        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return File(memory.ToArray(), "application/javascript; charset=utf-8");
    }

    private static JellyfinWebDiscoveryService GetDiscoveryService()
    {
        var webPath = Plugin.HostApplicationPaths?.WebPath;
        return new JellyfinWebDiscoveryService(JellyfinWebDiscoveryInputs.Current(webPath));
    }

    private static void SaveDiscoveredPath(JellyfinWebDiscoveryResult discovery)
    {
        if (Plugin.Instance is null || string.IsNullOrWhiteSpace(discovery.IndexHtmlPath))
        {
            return;
        }

        var cfg = Plugin.Instance.Configuration ?? new PluginConfiguration();
        if (!string.Equals(cfg.IndexHtmlPath, discovery.IndexHtmlPath, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
        {
            cfg.IndexHtmlPath = discovery.IndexHtmlPath;
            Plugin.Instance.UpdateConfiguration(cfg);
        }

        Plugin.SetResolvedIndex(discovery.WebRootPath, discovery.IndexHtmlPath);
    }

    private IActionResult DiscoveryResponse(JellyfinWebDiscoveryResult result)
    {
        if (result.Success)
        {
            _logger.LogInformation("[VA] Jellyfin Web discovered using {DiscoverySource} at {WebRootPath}", result.Source, result.WebRootPath);
            return Ok(new { ok = true, discovery = result });
        }

        _logger.LogWarning("[VA] Jellyfin Web discovery failed with code {ErrorCode}; preferred source {DiscoverySource}", result.ErrorCode, result.Source);
        var status = result.ErrorCode switch
        {
            "discovery_not_found" or "index_not_found" => StatusCodes.Status404NotFound,
            "selection_required" => StatusCodes.Status409Conflict,
            "index_not_writable" => StatusCodes.Status423Locked,
            _ => StatusCodes.Status400BadRequest
        };
        return StatusCode(status, new { ok = false, error = result.ErrorCode, message = result.Message, discovery = result });
    }

    private IActionResult MutationResponse(IndexMutationResult result)
    {
        if (result.Success)
        {
            return Ok(new { ok = true, changed = result.Changed });
        }

        _logger.LogWarning("[VA] Index mutation failed with code {ErrorCode}", result.Error);
        var status = result.Error == "invalid_index_path" ? StatusCodes.Status400BadRequest : StatusCodes.Status500InternalServerError;
        return StatusCode(status, new { ok = false, error = result.Error });
    }
}
