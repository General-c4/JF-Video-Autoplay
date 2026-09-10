namespace Jellyfin.Plugin.VideoAutoplay.Services;

public sealed record JellyfinWebInjectionResult(
    bool Success,
    JellyfinWebDiscoveryResult Discovery,
    IndexMutationResult? Mutation);

public sealed class JellyfinWebInjectionService
{
    private readonly JellyfinWebDiscoveryService _discovery;

    public JellyfinWebInjectionService(JellyfinWebDiscoveryService discovery) => _discovery = discovery;

    public async Task<JellyfinWebInjectionResult> InjectAsync(
        string? configuredPath,
        string loaderPath,
        Action<JellyfinWebDiscoveryResult> saveSelection,
        CancellationToken cancellationToken)
    {
        var discovery = _discovery.Discover(configuredPath, loaderPath);
        if (!discovery.Success)
        {
            return new(false, discovery, null);
        }

        saveSelection(discovery);
        var mutation = await new IndexFileService(discovery.WebRootPath)
            .InjectAsync(discovery.IndexHtmlPath, loaderPath, cancellationToken)
            .ConfigureAwait(false);
        return new(mutation.Success, discovery, mutation);
    }
}
