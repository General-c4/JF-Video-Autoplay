using System.Text;
using Jellyfin.Plugin.VideoAutoplay.Services;
using Xunit;

namespace Jellyfin.Plugin.VideoAutoplay.Tests;

public sealed class IndexFileServiceTests : IDisposable
{
    private readonly string _testRoot = Path.Combine(Path.GetTempPath(), "video-autoplay-tests-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task InjectionAndRemovalAreAtomicBackedUpAndIdempotent()
    {
        Directory.CreateDirectory(_testRoot);
        var index = Path.Combine(_testRoot, "index.html");
        await File.WriteAllTextAsync(index, "<!doctype html><body><main>Jellyfin</main></body>", new UTF8Encoding(true));
        var service = new IndexFileService(_testRoot);

        const string loader = "/VideoAutoplay/loader.js?v=1.1.1";
        var injected = await service.InjectAsync(index, loader, CancellationToken.None);
        Assert.True(injected.Success);
        Assert.True(injected.Changed);
        Assert.True(File.Exists(index + ".videoautoplay.bak"));
        Assert.Equal(1, CountMarkers(await File.ReadAllTextAsync(index)));
        Assert.Contains(loader, await File.ReadAllTextAsync(index));

        var injectedAgain = await service.InjectAsync(index, loader, CancellationToken.None);
        Assert.True(injectedAgain.Success);
        Assert.False(injectedAgain.Changed);
        Assert.Equal(1, CountMarkers(await File.ReadAllTextAsync(index)));

        var removed = await service.RemoveAsync(index, CancellationToken.None);
        Assert.True(removed.Success);
        Assert.True(removed.Changed);
        Assert.Equal(0, CountMarkers(await File.ReadAllTextAsync(index)));

        var removedAgain = await service.RemoveAsync(index, CancellationToken.None);
        Assert.True(removedAgain.Success);
        Assert.False(removedAgain.Changed);
    }

    [Theory]
    [InlineData("/VideoAutoplay/loader.js")]
    [InlineData("/VideoAutoplay/loader.js?v=1.1.0")]
    public async Task InjectionUpgradesLegacyTagWithoutDuplicatesAndRemovalRecognizesIt(string oldLoader)
    {
        Directory.CreateDirectory(_testRoot);
        var index = Path.Combine(_testRoot, "index.html");
        await File.WriteAllTextAsync(index, $"<body><script plugin=\"VideoAutoplay\" defer=\"defer\" src=\"{oldLoader}\"></script></body>");
        var service = new IndexFileService(_testRoot);
        const string currentLoader = "/VideoAutoplay/loader.js?v=1.1.1";

        var upgraded = await service.InjectAsync(index, currentLoader, CancellationToken.None);
        var upgradedHtml = await File.ReadAllTextAsync(index);
        Assert.True(upgraded.Success);
        Assert.True(upgraded.Changed);
        Assert.Equal(1, CountMarkers(upgradedHtml));
        Assert.Contains(currentLoader, upgradedHtml);
        Assert.DoesNotContain($"src=\"{oldLoader}\"", upgradedHtml);
        Assert.True(IndexFileService.ContainsLoader(upgradedHtml, currentLoader));

        var removed = await service.RemoveAsync(index, CancellationToken.None);
        Assert.True(removed.Success);
        Assert.True(removed.Changed);
        Assert.Equal(0, CountMarkers(await File.ReadAllTextAsync(index)));
    }

    [Theory]
    [InlineData("/VideoAutoplay/loader.js")]
    [InlineData("/VideoAutoplay/loader.js?v=1.1.1")]
    public async Task RemovalRecognizesOldAndVersionedTags(string loader)
    {
        Directory.CreateDirectory(_testRoot);
        var index = Path.Combine(_testRoot, "index.html");
        await File.WriteAllTextAsync(index, $"<body><script plugin=\"VideoAutoplay\" src=\"{loader}\"></script></body>");
        var result = await new IndexFileService(_testRoot).RemoveAsync(index, CancellationToken.None);
        Assert.True(result.Success);
        Assert.True(result.Changed);
        Assert.Equal(0, CountMarkers(await File.ReadAllTextAsync(index)));
    }

    [Fact]
    public async Task PathsOutsideWebRootAndTraversalAreRejected()
    {
        Directory.CreateDirectory(_testRoot);
        var index = Path.Combine(_testRoot, "index.html");
        await File.WriteAllTextAsync(index, "<body></body>");
        var outside = Path.Combine(Path.GetTempPath(), "outside-" + Guid.NewGuid().ToString("N") + ".html");
        await File.WriteAllTextAsync(outside, "<body></body>");
        try
        {
            var service = new IndexFileService(_testRoot);
            Assert.False(service.TryResolve(outside, out _));
            Assert.False(service.TryResolve(Path.Combine(_testRoot, "..", Path.GetFileName(outside)), out _));
            Assert.False((await service.InjectAsync(outside, "/loader.js", CancellationToken.None)).Success);
        }
        finally
        {
            File.Delete(outside);
        }
    }

    [Fact]
    public async Task MissingOrUnwritableTargetReportsFailure()
    {
        Directory.CreateDirectory(_testRoot);
        var service = new IndexFileService(_testRoot);
        var result = await service.InjectAsync(Path.Combine(_testRoot, "index.html"), "/loader.js", CancellationToken.None);
        Assert.False(result.Success);
        Assert.Equal("invalid_index_path", result.Error);
    }

    public void Dispose()
    {
        if (Directory.Exists(_testRoot))
        {
            Directory.Delete(_testRoot, true);
        }
    }

    private static int CountMarkers(string value)
        => value.Split(IndexFileService.Marker, StringSplitOptions.None).Length - 1;
}
