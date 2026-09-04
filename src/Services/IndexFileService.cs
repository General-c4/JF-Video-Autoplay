using System.Text;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.VideoAutoplay.Services;

public sealed record IndexMutationResult(bool Success, bool Changed, string Error)
{
    public static IndexMutationResult Ok(bool changed) => new(true, changed, string.Empty);

    public static IndexMutationResult Fail(string error) => new(false, false, error);
}

public sealed class IndexFileService
{
    internal const string Marker = "plugin=\"VideoAutoplay\"";
    private static readonly SemaphoreSlim MutationLock = new(1, 1);
    private static readonly Regex TagRegex = new(
        @"\s*<script\s+plugin=""VideoAutoplay""[^>]*>\s*</script>\s*",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));

    private readonly string _indexPath;

    internal static bool ContainsLoader(string html, string loaderPath)
        => TagRegex.Matches(html).Any(match => match.Value.Contains($"src=\"{loaderPath}\"", StringComparison.OrdinalIgnoreCase));

    public IndexFileService(string webRootPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(webRootPath);
        _indexPath = Path.GetFullPath(Path.Combine(webRootPath, "index.html"));
    }

    public bool TryResolve(string? configuredPath, out string resolvedPath)
    {
        resolvedPath = string.Empty;
        if (string.IsNullOrWhiteSpace(configuredPath))
        {
            configuredPath = _indexPath;
        }

        try
        {
            var candidate = Path.GetFullPath(configuredPath);
            var comparison = OperatingSystem.IsWindows()
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
            if (!candidate.Equals(_indexPath, comparison) || !File.Exists(candidate))
            {
                return false;
            }

            resolvedPath = candidate;
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException)
        {
            return false;
        }
    }

    public async Task<IndexMutationResult> InjectAsync(string configuredPath, string loaderPath, CancellationToken cancellationToken)
    {
        if (!TryResolve(configuredPath, out var path))
        {
            return IndexMutationResult.Fail("invalid_index_path");
        }

        return await MutateAsync(path, true, loaderPath, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IndexMutationResult> RemoveAsync(string configuredPath, CancellationToken cancellationToken)
    {
        if (!TryResolve(configuredPath, out var path))
        {
            return IndexMutationResult.Fail("invalid_index_path");
        }

        return await MutateAsync(path, false, string.Empty, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<IndexMutationResult> MutateAsync(
        string path,
        bool inject,
        string loaderPath,
        CancellationToken cancellationToken)
    {
        await MutationLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var originalBytes = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
            var hasBom = originalBytes.AsSpan().StartsWith(Encoding.UTF8.Preamble);
            var offset = hasBom ? Encoding.UTF8.Preamble.Length : 0;
            var html = Encoding.UTF8.GetString(originalBytes, offset, originalBytes.Length - offset);
            var withoutTag = TagRegex.Replace(html, string.Empty);
            string output;

            if (inject)
            {
                var tag = $"<script plugin=\"VideoAutoplay\" defer=\"defer\" src=\"{loaderPath}\"></script>";
                var bodyClose = withoutTag.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
                output = bodyClose >= 0
                    ? withoutTag.Insert(bodyClose, tag + Environment.NewLine)
                    : withoutTag + Environment.NewLine + tag + Environment.NewLine;
            }
            else
            {
                output = withoutTag;
            }

            if (output.Equals(html, StringComparison.Ordinal))
            {
                return IndexMutationResult.Ok(false);
            }

            if (inject && TagRegex.Matches(output).Count != 1)
            {
                return IndexMutationResult.Fail("validation_failed");
            }

            if (!inject && output.Contains(Marker, StringComparison.OrdinalIgnoreCase))
            {
                return IndexMutationResult.Fail("validation_failed");
            }

            var directory = Path.GetDirectoryName(path)!;
            var tempPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
            var backupPath = path + ".videoautoplay.bak";
            try
            {
                var utf8 = new UTF8Encoding(hasBom);
                await File.WriteAllTextAsync(tempPath, output, utf8, cancellationToken).ConfigureAwait(false);
                var written = await File.ReadAllTextAsync(tempPath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
                if ((inject && TagRegex.Matches(written).Count != 1)
                    || (!inject && written.Contains(Marker, StringComparison.OrdinalIgnoreCase)))
                {
                    return IndexMutationResult.Fail("validation_failed");
                }

                File.Copy(path, backupPath, true);
                try
                {
                    File.Replace(tempPath, path, null);
                }
                catch (PlatformNotSupportedException)
                {
                    File.Move(tempPath, path, true);
                }
                catch (IOException)
                {
                    File.Move(tempPath, path, true);
                }

                return IndexMutationResult.Ok(true);
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                }
            }
        }
        catch (OperationCanceledException)
        {
            return IndexMutationResult.Fail("cancelled");
        }
        catch (Exception)
        {
            return IndexMutationResult.Fail("write_failed");
        }
        finally
        {
            MutationLock.Release();
        }
    }
}
