using Jellyfin.Plugin.VideoAutoplay.Services;
using Xunit;

namespace Jellyfin.Plugin.VideoAutoplay.Tests;

public sealed class JellyfinWebDiscoveryServiceTests : IDisposable
{
    private const string Loader = "/VideoAutoplay/loader.js?v=1.1.2-rc5";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "video-autoplay-discovery-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData("application_web_path")]
    [InlineData("environment_web_dir")]
    [InlineData("command_line_webdir")]
    [InlineData("official_docker")]
    [InlineData("linux_package")]
    public void TrustedDiscoverySourcesAreRecognized(string source)
    {
        var web = CreateWeb(source);
        var inputs = Inputs(
            application: source == "application_web_path" ? web : null,
            environment: source == "environment_web_dir" ? web : null,
            arguments: source == "command_line_webdir" ? new[] { "jellyfin", "--webdir", web } : Array.Empty<string>(),
            docker: source == "official_docker" ? web : Missing("docker"),
            linux: source == "linux_package" ? web : Missing("linux"));
        var result = new JellyfinWebDiscoveryService(inputs).Discover(string.Empty, Loader);
        Assert.True(result.Success);
        Assert.Equal(source, result.Source);
        Assert.Equal(Path.Combine(web, "index.html"), result.IndexHtmlPath);
        Assert.True(result.Exists && result.Readable && result.Writable && result.IsRecognizedJellyfinWeb);
    }

    [Fact]
    public void EqualsSyntaxCommandLineWebDirIsRecognized()
    {
        var web = CreateWeb("equals");
        var result = Service(arguments: new[] { "--webdir=" + web }).Discover(null, Loader);
        Assert.True(result.Success);
        Assert.Equal("command_line_webdir", result.Source);
    }

    [Fact]
    public void PortableWebDirectoryIsDiscovered()
    {
        var app = Path.Combine(_root, "portable");
        var web = Path.Combine(app, "jellyfin-web");
        CreateIndex(web, Jellyfin12Html());
        var result = new JellyfinWebDiscoveryService(Inputs(appBase: app)).Discover(null, Loader);
        Assert.True(result.Success);
        Assert.Equal("app_base", result.Source);
        Assert.Equal(web, result.WebRootPath);
    }

    [Fact]
    public void ProcessDirectoryCandidateIsDiscovered()
    {
        var process = Path.Combine(_root, "windows-process");
        var web = Path.Combine(process, "web");
        CreateIndex(web, Jellyfin12Html());
        var inputs = new JellyfinWebDiscoveryInputs(null, null, Array.Empty<string>(), Missing("app"), process, Missing("docker"), Missing("linux"), "no");
        var result = new JellyfinWebDiscoveryService(inputs).Discover(null, Loader);
        Assert.True(result.Success);
        Assert.Equal("process_directory", result.Source);
        Assert.False(result.HasApplicationWebPath);
        Assert.Equal("no", result.ContainerEnvironment);
    }

    [Fact]
    public void BlankAndStaleConfiguredPathsTriggerDiscovery()
    {
        var web = CreateWeb("fallback");
        var service = Service(application: web);
        Assert.True(service.Discover(string.Empty, Loader).Success);
        var stale = Path.Combine(_root, "volume1", "docker", "jellyfin", "jellyfin-web", "index.html");
        var result = service.Discover(stale, Loader);
        Assert.True(result.Success);
        Assert.Equal("application_web_path", result.Source);
    }

    [Fact]
    public void InvisibleSynologyHostPathIsRejected()
    {
        var result = Service().Discover(Path.Combine(_root, "volume1", "docker", "jellyfin", "jellyfin-web", "index.html"), Loader);
        Assert.False(result.Success);
        Assert.Equal("discovery_not_found", result.ErrorCode);
        Assert.Contains("in-container", result.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MultipleCandidatesRequireSelection()
    {
        var first = CreateWeb("first");
        var second = CreateWeb("second");
        var result = Service(application: first, environment: second).Discover(null, Loader);
        Assert.False(result.Success);
        Assert.Equal("selection_required", result.ErrorCode);
        Assert.Equal(2, result.Candidates.Count);
        Assert.Equal("application_web_path", result.Source);
    }

    [Fact]
    public void SymlinkEscapeIsRejectedWhenSupported()
    {
        var web = Path.Combine(_root, "linked");
        var outside = Path.Combine(_root, "outside", "index.html");
        Directory.CreateDirectory(web);
        CreateIndex(Path.GetDirectoryName(outside)!, Jellyfin12Html());
        var link = Path.Combine(web, "index.html");
        try
        {
            File.CreateSymbolicLink(link, outside);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException or PlatformNotSupportedException)
        {
            return;
        }

        var result = Service(application: web).Discover(null, Loader);
        Assert.False(result.Success);
        Assert.Contains(result.Candidates, candidate => candidate.ErrorCode == "symlink_escape");
    }

    [Theory]
    [InlineData("<html><body>unrelated</body></html>")]
    [InlineData("<!doctype html><div id=\"reactRoot\"></div><script src=\"main.jellyfin.js\"></script>")]
    public void UnrelatedOrIncompleteHtmlIsRejected(string html)
    {
        var web = Path.Combine(_root, Guid.NewGuid().ToString("N"));
        CreateIndex(web, html);
        var result = Service(application: web).Discover(null, Loader);
        Assert.False(result.Success);
        Assert.Contains(result.Candidates, candidate => candidate.ErrorCode == "not_jellyfin_web");
    }

    [Fact]
    public void ReadOnlyIndexReturnsTypedError()
    {
        var web = CreateWeb("readonly");
        var index = Path.Combine(web, "index.html");
        File.SetAttributes(index, File.GetAttributes(index) | FileAttributes.ReadOnly);
        try
        {
            var result = Service(application: web).Discover(null, Loader);
            Assert.False(result.Success);
            Assert.Equal("index_not_writable", result.ErrorCode);
        }
        finally
        {
            File.SetAttributes(index, File.GetAttributes(index) & ~FileAttributes.ReadOnly);
        }
    }

    [Fact]
    public async Task AutomaticInjectionSavesSelectionAndIsIdempotent()
    {
        var web = CreateWeb("automatic");
        string? saved = null;
        var service = new JellyfinWebInjectionService(Service(application: web));
        var first = await service.InjectAsync(string.Empty, Loader, result => saved = result.IndexHtmlPath, CancellationToken.None);
        Assert.True(first.Success);
        Assert.True(first.Mutation!.Changed);
        Assert.Equal(Path.Combine(web, "index.html"), saved);
        var second = await service.InjectAsync(saved, Loader, _ => { }, CancellationToken.None);
        Assert.True(second.Success);
        Assert.False(second.Mutation!.Changed);
        var html = await File.ReadAllTextAsync(saved!);
        Assert.Equal(1, html.Split(IndexFileService.Marker, StringSplitOptions.None).Length - 1);
    }

    [Fact]
    public void Jellyfin10And12MarkersAreRecognizedAndUpgradeLossIsReported()
    {
        Assert.True(JellyfinWebDiscoveryService.IsJellyfinWeb(Jellyfin12Html()));
        Assert.True(JellyfinWebDiscoveryService.IsJellyfinWeb(Jellyfin10Html()));
        var web = CreateWeb("upgrade", Jellyfin12Html().Replace("</body>", $"<script plugin=\"VideoAutoplay\" src=\"{Loader}\"></script></body>"));
        Assert.True(Service(application: web).Discover(null, Loader).IsCurrentInjection);
        File.WriteAllText(Path.Combine(web, "index.html"), Jellyfin12Html());
        var afterUpgrade = Service(application: web).Discover(null, Loader);
        Assert.True(afterUpgrade.Success);
        Assert.False(afterUpgrade.IsCurrentInjection);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, true);
        }
    }

    private JellyfinWebDiscoveryService Service(string? application = null, string? environment = null, IReadOnlyList<string>? arguments = null)
        => new(Inputs(application, environment, arguments));

    private JellyfinWebDiscoveryInputs Inputs(
        string? application = null,
        string? environment = null,
        IReadOnlyList<string>? arguments = null,
        string? appBase = null,
        string? docker = null,
        string? linux = null)
        => new(application, environment, arguments ?? Array.Empty<string>(), appBase ?? Missing("app"), Missing("process"), docker ?? Missing("docker"), linux ?? Missing("linux"), "yes");

    private string CreateWeb(string name, string? html = null)
    {
        var path = Path.Combine(_root, name);
        CreateIndex(path, html ?? Jellyfin12Html());
        return path;
    }

    private static void CreateIndex(string webRoot, string html)
    {
        Directory.CreateDirectory(webRoot);
        File.WriteAllText(Path.Combine(webRoot, "index.html"), html);
    }

    private string Missing(string name) => Path.Combine(_root, "missing", name);

    private static string Jellyfin12Html()
        => "<!doctype html><html><body><div id=\"reactRoot\"></div><script src=\"runtime.bundle.js\"></script><script src=\"main.jellyfin.bundle.js\"></script></body></html>";

    private static string Jellyfin10Html()
        => "<!DOCTYPE html><html><body><div class=\"dashboardDocument\"></div><script src=\"jellyfin-apiclient.bundle.js\"></script></body></html>";
}
