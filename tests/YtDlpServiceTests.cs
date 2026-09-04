using Jellyfin.Plugin.VideoAutoplay.Services;
using Xunit;

namespace Jellyfin.Plugin.VideoAutoplay.Tests;

public sealed class YtDlpServiceTests
{
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=abc")]
    [InlineData("https://youtube.com/watch?v=abc")]
    [InlineData("https://m.youtube.com/watch?v=abc")]
    [InlineData("https://youtu.be/abc")]
    public void ApprovedYouTubeHostsAreAccepted(string value)
        => Assert.True(YtDlpService.TryValidateYouTubeUri(value, out _));

    [Theory]
    [InlineData("http://www.youtube.com/watch?v=abc")]
    [InlineData("https://youtube.com.evil.example/watch?v=abc")]
    [InlineData("https://evil.example/?next=youtube.com")]
    [InlineData("https://user:pass@youtube.com/watch?v=abc")]
    [InlineData("https://youtube.com:8443/watch?v=abc")]
    [InlineData("https://youtube.com/watch?v=abc#fragment")]
    [InlineData("not-a-url")]
    public void UnsafeOrDeceptiveUrisAreRejected(string value)
        => Assert.False(YtDlpService.TryValidateYouTubeUri(value, out _));

    [Fact]
    public async Task OutputLimitIsEnforced()
    {
        var reader = new StringReader(new string('x', 32));
        await Assert.ThrowsAsync<InvalidDataException>(() => YtDlpService.ReadLimitedAsync(reader, 16, CancellationToken.None));
    }

    [Fact]
    public async Task OutputReadHonorsCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => YtDlpService.ReadLimitedAsync(new SlowReader(), 1024, cancellation.Token));
    }

    [Fact]
    public void ResourceLimitsArePinned()
    {
        Assert.Equal(2, YtDlpService.MaxConcurrency);
        Assert.Equal(TimeSpan.FromSeconds(15), YtDlpService.Timeout);
        Assert.Equal(2 * 1024 * 1024, YtDlpService.MaxOutputCharacters);
    }

    [Fact]
    public void UrlIsPassedAsOneArgumentWithoutShellParsing()
    {
        var uri = new Uri("https://www.youtube.com/watch?v=abc&list=def");
        var startInfo = YtDlpService.CreateStartInfo(Environment.ProcessPath!, uri, "18");
        Assert.False(startInfo.UseShellExecute);
        Assert.Equal(uri.AbsoluteUri, startInfo.ArgumentList[^1]);
        Assert.Equal(7, startInfo.ArgumentList.Count);
        Assert.Contains("--no-config", startInfo.ArgumentList);
    }

    [Fact]
    public async Task PreCancelledRequestDoesNotStartAProcess()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var result = await new YtDlpService().ResolveAsync(
            Environment.ProcessPath!,
            "https://youtu.be/abc",
            "18",
            true,
            true,
            cancellation.Token);
        Assert.False(result.Success);
        Assert.Equal("cancelled", result.Error);
    }

    private sealed class SlowReader : TextReader
    {
        public override ValueTask<int> ReadAsync(Memory<char> buffer, CancellationToken cancellationToken = default)
            => ValueTask.FromCanceled<int>(cancellationToken);
    }
}
