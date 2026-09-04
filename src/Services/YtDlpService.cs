using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Jellyfin.Plugin.VideoAutoplay.Services;

public sealed record YtDlpResult(
    bool Success,
    string Error,
    string? Url = null,
    string? Extension = null,
    string? Protocol = null,
    bool IsHls = false);

public sealed class YtDlpService
{
    internal const int MaxOutputCharacters = 2 * 1024 * 1024;
    internal const int MaxConcurrency = 2;
    internal static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);
    private static readonly SemaphoreSlim ConcurrencyGate = new(MaxConcurrency, MaxConcurrency);
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtube-nocookie.com"
    };

    public static bool TryValidateYouTubeUri(string? value, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var candidate)
            || candidate.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(candidate.UserInfo)
            || !string.IsNullOrEmpty(candidate.Fragment)
            || (!candidate.IsDefaultPort && candidate.Port != 443)
            || !AllowedHosts.Contains(candidate.IdnHost))
        {
            return false;
        }

        uri = candidate;
        return true;
    }

    public async Task<YtDlpResult> ResolveAsync(
        string executablePath,
        string url,
        string? mode,
        bool preferMp4,
        bool force18,
        CancellationToken requestCancellation)
    {
        if (!Path.IsPathFullyQualified(executablePath) || !File.Exists(executablePath))
        {
            return new(false, "invalid_executable");
        }

        if (!TryValidateYouTubeUri(url, out var uri))
        {
            return new(false, "invalid_url");
        }

        if (requestCancellation.IsCancellationRequested)
        {
            return new(false, "cancelled");
        }

        if (!await ConcurrencyGate.WaitAsync(0, requestCancellation).ConfigureAwait(false))
        {
            return new(false, "busy");
        }

        try
        {
            if (string.Equals(mode, "mp4", StringComparison.OrdinalIgnoreCase))
            {
                preferMp4 = true;
            }
            else if (string.Equals(mode, "hls", StringComparison.OrdinalIgnoreCase))
            {
                preferMp4 = false;
            }
            else if (string.Equals(mode, "18", StringComparison.OrdinalIgnoreCase))
            {
                force18 = true;
                preferMp4 = true;
            }

            var format = force18
                ? "18"
                : preferMp4
                    ? "best[ext=mp4][vcodec!=none][acodec!=none]/18/best[vcodec!=none][acodec!=none]/best"
                    : "best[vcodec!=none][acodec!=none]/best";

            var startInfo = CreateStartInfo(executablePath, uri!, format);

            using var process = new Process { StartInfo = startInfo };
            if (!process.Start())
            {
                return new(false, "start_failed");
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(requestCancellation);
            timeout.CancelAfter(Timeout);
            try
            {
                var stdoutTask = ReadLimitedAsync(process.StandardOutput, timeout.Token);
                var stderrTask = ReadLimitedAsync(process.StandardError, timeout.Token);
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
                var stdout = await stdoutTask.ConfigureAwait(false);
                _ = await stderrTask.ConfigureAwait(false);
                if (process.ExitCode != 0)
                {
                    return new(false, "yt_dlp_failed");
                }

                using var document = JsonDocument.Parse(stdout);
                var root = document.RootElement;
                var directUrl = root.TryGetProperty("url", out var urlElement) ? urlElement.GetString() : null;
                if (!Uri.TryCreate(directUrl, UriKind.Absolute, out var directUri)
                    || directUri.Scheme != Uri.UriSchemeHttps)
                {
                    return new(false, "invalid_output");
                }

                var extension = root.TryGetProperty("ext", out var extElement) ? extElement.GetString() : null;
                var protocol = root.TryGetProperty("protocol", out var protocolElement) ? protocolElement.GetString() : null;
                var isHls = (protocol?.Contains("m3u8", StringComparison.OrdinalIgnoreCase) ?? false)
                    || directUri.AbsoluteUri.Contains(".m3u8", StringComparison.OrdinalIgnoreCase);
                return new(true, string.Empty, directUri.AbsoluteUri, extension, protocol, isHls);
            }
            catch (OperationCanceledException)
            {
                TryKill(process);
                return new(false, requestCancellation.IsCancellationRequested ? "cancelled" : "timeout");
            }
            catch (InvalidDataException)
            {
                TryKill(process);
                return new(false, "output_too_large");
            }
            catch (JsonException)
            {
                return new(false, "invalid_output");
            }
        }
        catch (Exception)
        {
            return new(false, "execution_failed");
        }
        finally
        {
            ConcurrencyGate.Release();
        }
    }

    internal static ProcessStartInfo CreateStartInfo(string executablePath, Uri uri, string format)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.GetFullPath(executablePath),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("--no-warnings");
        startInfo.ArgumentList.Add("--no-playlist");
        startInfo.ArgumentList.Add("--no-config");
        startInfo.ArgumentList.Add("--format");
        startInfo.ArgumentList.Add(format);
        startInfo.ArgumentList.Add("--dump-single-json");
        startInfo.ArgumentList.Add(uri.AbsoluteUri);
        return startInfo;
    }

    internal static async Task<string> ReadLimitedAsync(TextReader reader, int limit, CancellationToken cancellationToken)
    {
        var result = new StringBuilder();
        var buffer = new char[8192];
        while (true)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                return result.ToString();
            }

            if (result.Length + count > limit)
            {
                throw new InvalidDataException("Process output exceeded the configured limit.");
            }

            result.Append(buffer, 0, count);
        }
    }

    private static Task<string> ReadLimitedAsync(StreamReader reader, CancellationToken cancellationToken)
        => ReadLimitedAsync(reader, MaxOutputCharacters, cancellationToken);

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(true);
            }
        }
        catch (InvalidOperationException)
        {
        }
    }
}
