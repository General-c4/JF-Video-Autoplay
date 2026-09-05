using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Jellyfin.Plugin.VideoAutoplay.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.VideoAutoplay.Tests;

public sealed class ArtifactTests
{
    private static readonly string ProjectRoot = FindProjectRoot();

    [Fact]
    public void AssemblyAndManifestVersionsAreConsistent()
    {
        var assemblyVersion = typeof(Plugin).Assembly.GetName().Version;
        Assert.Equal(new Version(1, 1, 2, 1), assemblyVersion);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(ProjectRoot, "manifest.json")));
        var version = manifest.RootElement[0].GetProperty("versions")[0];
        Assert.Equal("1.1.2.1", version.GetProperty("version").GetString());
        Assert.Equal("10.11.0.0", version.GetProperty("targetAbi").GetString());
    }

    [Fact]
    public void ClientOutputAndCurrentSourceContainNoSharedApiKey()
    {
        Assert.Null(typeof(PluginConfiguration).GetProperty("ApiKey"));
        var roots = new[] { Path.Combine(ProjectRoot, "src"), Path.Combine(ProjectRoot, "README.md") };
        foreach (var root in roots)
        {
            var files = File.Exists(root)
                ? new[] { root }
                : Directory.GetFiles(root, "*", SearchOption.AllDirectories)
                    .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                        && !path.Contains($"{Path.DirectorySeparatorChar}vendor{Path.DirectorySeparatorChar}"));
            foreach (var file in files.Where(path => Path.GetExtension(path) is ".cs" or ".js" or ".html" or ".md"))
            {
                var content = File.ReadAllText(file);
                Assert.DoesNotContain("api_key=", content, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("ApiKey", content, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public void JellyfinParsesRcNumericVersionAsAnUpdate()
    {
        var rc = new MediaBrowser.Model.Updates.VersionInfo { Version = "1.1.2.1" };
        Assert.True(rc.VersionNumber > new Version(1, 1, 1, 0));
        Assert.True(new Version("1.1.2.2") > rc.VersionNumber);
        Assert.Equal(rc.VersionNumber, typeof(Plugin).Assembly.GetName().Version);
        Assert.Equal("1.1.2-rc1", Plugin.ToolVersion);
    }

    [Fact]
    public void RequiredResourcesAreEmbedded()
    {
        var resources = typeof(Plugin).Assembly.GetManifestResourceNames();
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Controllers.configPage.html", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.loader.js", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.media-cache.js", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.runtime.js", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.video-autoplay.js", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.vendor.hls.min.js", resources);
        Assert.Contains("Jellyfin.Plugin.VideoAutoplay.Web.vendor.hls.LICENSE.txt", resources);
    }

    [Fact]
    public void DevelopmentManifestDoesNotClaimAnUnbuiltChecksum()
    {
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(ProjectRoot, "manifest.json")));
        var version = manifest.RootElement[0].GetProperty("versions")[0];
        Assert.Equal("1.1.2.1", version.GetProperty("version").GetString());
        Assert.Equal(string.Empty, version.GetProperty("checksum").GetString());
    }

    [Fact]
    public void MediaCacheBehaviorTestsPass()
    {
        RunNode(Path.Combine(ProjectRoot, "tests", "media-cache.test.js"));
        RunNode(Path.Combine(ProjectRoot, "tests", "runtime.test.js"));
        RunNode(Path.Combine(ProjectRoot, "tests", "loader.test.js"));
    }

    [Fact]
    public void FrontendImplementsControlledRefreshAndCleanup()
    {
        var content = File.ReadAllText(Path.Combine(ProjectRoot, "src", "Web", "video-autoplay.js"));
        Assert.Contains("MEDIA_REFRESH_INTERVAL_MS = 60000", content, StringComparison.Ordinal);
        Assert.Contains("if(S.refreshing) return S.refreshPromise", content, StringComparison.Ordinal);
        Assert.Contains("refreshGeneration!==S.refreshGeneration", content, StringComparison.Ordinal);
        Assert.Contains("visibilitychange", content, StringComparison.Ordinal);
        Assert.Contains("S.intervals.forEach", content, StringComparison.Ordinal);
        Assert.Contains("trailerCache.invalidateItem", content, StringComparison.Ordinal);
        Assert.Contains("if(nextMediaKey===S.currentMediaKey) return", content, StringComparison.Ordinal);
        Assert.Contains("disposeMedia(); S.currentMediaKey=nextMediaKey", content, StringComparison.Ordinal);
    }

    [Fact]
    public void FrontendRequestsRevisionFieldsAndNeverPutsTokensInMediaQueries()
    {
        var content = File.ReadAllText(Path.Combine(ProjectRoot, "src", "Web", "video-autoplay.js"));
        Assert.Contains("DateModified", content, StringComparison.Ordinal);
        Assert.Contains("ImageTags,BackdropImageTags,ParentBackdropImageTags,MediaSources", content, StringComparison.Ordinal);
        Assert.DoesNotContain("api_key=", content, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("accessToken() +", content, StringComparison.Ordinal);
    }

    [Fact]
    public void LoaderUsesVersionedSequentialDependenciesAndLogsFailures()
    {
        var content = File.ReadAllText(Path.Combine(ProjectRoot, "src", "Web", "loader.js"));
        var config = content.IndexOf("loadScript('/VideoAutoplay/config.js')", StringComparison.Ordinal);
        var cache = content.IndexOf("loadScript('/VideoAutoplay/media-cache.js')", StringComparison.Ordinal);
        var main = content.IndexOf("loadScript('/VideoAutoplay/video-autoplay.js')", StringComparison.Ordinal);
        Assert.True(config >= 0 && cache > config && main > cache);
        Assert.Contains("const version = '1.1.2-rc1'", content, StringComparison.Ordinal);
        Assert.Contains("Failed to load dependency", content, StringComparison.Ordinal);
        Assert.Contains("Loader stopped", content, StringComparison.Ordinal);
        Assert.DoesNotContain("Date.now()", content, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(nameof(VaController.Loader))]
    [InlineData(nameof(VaController.MediaCacheJs))]
    [InlineData(nameof(VaController.RuntimeJs))]
    [InlineData(nameof(VaController.MainJs))]
    [InlineData(nameof(VaController.HlsJs))]
    public void PublicScriptEndpointsReturnJavascript(string methodName)
    {
        var controller = new VaController(NullLogger<VaController>.Instance);
        var result = Assert.IsType<FileContentResult>(typeof(VaController).GetMethod(methodName)!.Invoke(controller, null));
        Assert.Equal("application/javascript; charset=utf-8", result.ContentType);
        Assert.NotEmpty(result.FileContents);
    }

    [Fact]
    public void PublicConfigEndpointReturnsJavascript()
    {
        var controller = new VaController(NullLogger<VaController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var result = Assert.IsType<ContentResult>(controller.ConfigJs());
        Assert.Equal("application/javascript; charset=utf-8", result.ContentType);
        Assert.Contains("window.JF_VA_CONFIG=", result.Content, StringComparison.Ordinal);
    }

    private static void RunNode(string script)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            ArgumentList = { script }
        });
        Assert.NotNull(process);
        process.WaitForExit();
        Assert.True(process.ExitCode == 0, process.StandardError.ReadToEnd() + process.StandardOutput.ReadToEnd());
    }

    [Fact]
    public void FrontendContainsRenderGenerationProtectionAndParses()
    {
        var script = Path.Combine(ProjectRoot, "src", "Web", "video-autoplay.js");
        var content = File.ReadAllText(script);
        Assert.Contains("renderGeneration", content, StringComparison.Ordinal);
        Assert.Contains("generation !== S.renderGeneration", content, StringComparison.Ordinal);
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            ArgumentList = { "--check", script }
        });
        Assert.NotNull(process);
        process.WaitForExit();
        Assert.True(process.ExitCode == 0, process.StandardError.ReadToEnd());
    }

    private static string FindProjectRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "manifest.json")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new DirectoryNotFoundException("Project root not found.");
    }
}
