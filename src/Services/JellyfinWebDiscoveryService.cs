using System.Runtime.InteropServices;

namespace Jellyfin.Plugin.VideoAutoplay.Services;

public sealed record JellyfinWebCandidate(
    string WebRootPath,
    string IndexHtmlPath,
    string Source,
    bool Exists,
    bool Readable,
    bool Writable,
    bool IsRecognizedJellyfinWeb,
    bool AlreadyInjected,
    bool IsCurrentInjection,
    string ErrorCode);

public sealed record JellyfinWebDiscoveryResult(
    bool Success,
    string WebRootPath,
    string IndexHtmlPath,
    string Source,
    bool Exists,
    bool Readable,
    bool Writable,
    bool IsRecognizedJellyfinWeb,
    bool AlreadyInjected,
    bool IsCurrentInjection,
    string ErrorCode,
    string Message,
    string OperatingSystem,
    string ContainerEnvironment,
    bool HasApplicationWebPath,
    bool HasEnvironmentWebDir,
    bool HasCommandLineWebDir,
    IReadOnlyList<JellyfinWebCandidate> Candidates);

public sealed record JellyfinWebDiscoveryInputs(
    string? ApplicationWebPath,
    string? EnvironmentWebDir,
    IReadOnlyList<string> CommandLineArguments,
    string AppBaseDirectory,
    string? ProcessDirectory,
    string DockerWebRoot,
    string LinuxPackageWebRoot,
    string ContainerEnvironment)
{
    public static JellyfinWebDiscoveryInputs Current(string? applicationWebPath)
    {
        var processPath = Environment.ProcessPath;
        return new(
            applicationWebPath,
            Environment.GetEnvironmentVariable("JELLYFIN_WEB_DIR"),
            Environment.GetCommandLineArgs(),
            AppContext.BaseDirectory,
            string.IsNullOrWhiteSpace(processPath) ? null : Path.GetDirectoryName(processPath),
            "/jellyfin/jellyfin-web",
            "/usr/share/jellyfin/web",
            DetectContainer());
    }

    private static string DetectContainer()
    {
        var value = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER");
        if (bool.TryParse(value, out var inContainer))
        {
            return inContainer ? "yes" : "no";
        }

        return File.Exists("/.dockerenv") ? "yes" : "unknown";
    }
}

public sealed class JellyfinWebDiscoveryService
{
    private const int MaximumIndexBytes = 5 * 1024 * 1024;
    private readonly JellyfinWebDiscoveryInputs _inputs;

    public JellyfinWebDiscoveryService(JellyfinWebDiscoveryInputs inputs) => _inputs = inputs;

    public JellyfinWebDiscoveryResult Discover(string? configuredPath, string currentLoaderPath)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            var configured = Evaluate("configured", configuredPath, currentLoaderPath);
            if (configured is { Exists: true, Readable: true, IsRecognizedJellyfinWeb: true })
            {
                return configured.Writable
                    ? Result(true, configured, string.Empty, "The configured in-container Jellyfin Web path is valid.", new[] { configured })
                    : Result(false, configured, "index_not_writable", "Jellyfin Web index.html exists but is not writable by the Jellyfin server process.", new[] { configured });
            }
        }

        var requested = new List<(string Source, string Path)>();
        Add(requested, "application_web_path", _inputs.ApplicationWebPath);
        Add(requested, "environment_web_dir", _inputs.EnvironmentWebDir);
        Add(requested, "command_line_webdir", ReadWebDirArgument(_inputs.CommandLineArguments));
        Add(requested, "official_docker", _inputs.DockerWebRoot);
        Add(requested, "linux_package", _inputs.LinuxPackageWebRoot);
        AddPortableCandidates(requested, _inputs.AppBaseDirectory, "app_base");
        AddPortableCandidates(requested, _inputs.ProcessDirectory, "process_directory");
        Add(requested, "configured", configuredPath);

        var comparer = OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        var evaluated = new List<JellyfinWebCandidate>();
        var seen = new HashSet<string>(comparer);
        foreach (var item in requested)
        {
            var candidate = Evaluate(item.Source, item.Path, currentLoaderPath);
            if (candidate is null || !seen.Add(candidate.IndexHtmlPath))
            {
                continue;
            }

            evaluated.Add(candidate);
        }

        var valid = evaluated.Where(candidate => candidate.Exists && candidate.Readable && candidate.IsRecognizedJellyfinWeb).ToArray();
        if (valid.Length == 0)
        {
            return Result(false, null, "discovery_not_found",
                "Jellyfin Web was not found inside the server process. In Docker, use an in-container path such as /jellyfin/jellyfin-web/index.html; a Synology host path is only visible when explicitly bind-mounted.", evaluated);
        }

        if (valid.Length > 1)
        {
            return Result(false, valid[0], "selection_required",
                "Multiple Jellyfin Web installations were found. Select the intended in-container index.html path.", valid);
        }

        var selected = valid[0];
        if (!selected.Writable)
        {
            return Result(false, selected, "index_not_writable",
                "Jellyfin Web index.html exists but is not writable by the Jellyfin server process.", valid);
        }

        return Result(true, selected, string.Empty, "Jellyfin Web index.html was discovered successfully.", valid);
    }

    public JellyfinWebDiscoveryResult ValidateConfigured(string configuredPath, string currentLoaderPath)
    {
        var candidate = Evaluate("configured", configuredPath, currentLoaderPath);
        if (candidate is null || !candidate.Exists)
        {
            return Result(false, candidate, "index_not_found", "The configured index.html path is not visible inside the Jellyfin server process.", candidate is null ? Array.Empty<JellyfinWebCandidate>() : new[] { candidate });
        }

        if (!candidate.Readable)
        {
            return Result(false, candidate, candidate.ErrorCode, "The configured index.html is not readable by the Jellyfin server process.", new[] { candidate });
        }

        if (!candidate.IsRecognizedJellyfinWeb)
        {
            return Result(false, candidate, "not_jellyfin_web", "The configured file is not a recognized Jellyfin Web index.html.", new[] { candidate });
        }

        if (!candidate.Writable)
        {
            return Result(false, candidate, "index_not_writable", "Jellyfin Web index.html exists but is not writable by the Jellyfin server process.", new[] { candidate });
        }

        return Result(true, candidate, string.Empty, "The configured in-container Jellyfin Web path is valid.", new[] { candidate });
    }

    private JellyfinWebDiscoveryResult Result(
        bool success,
        JellyfinWebCandidate? selected,
        string errorCode,
        string message,
        IReadOnlyList<JellyfinWebCandidate> candidates)
        => new(
            success,
            selected?.WebRootPath ?? string.Empty,
            selected?.IndexHtmlPath ?? string.Empty,
            selected?.Source ?? string.Empty,
            selected?.Exists ?? false,
            selected?.Readable ?? false,
            selected?.Writable ?? false,
            selected?.IsRecognizedJellyfinWeb ?? false,
            selected?.AlreadyInjected ?? false,
            selected?.IsCurrentInjection ?? false,
            errorCode,
            message,
            RuntimeInformation.OSDescription,
            _inputs.ContainerEnvironment,
            !string.IsNullOrWhiteSpace(_inputs.ApplicationWebPath),
            !string.IsNullOrWhiteSpace(_inputs.EnvironmentWebDir),
            ReadWebDirArgument(_inputs.CommandLineArguments) is not null,
            candidates);

    private static void Add(List<(string Source, string Path)> values, string source, string? path)
    {
        if (!string.IsNullOrWhiteSpace(path))
        {
            values.Add((source, path));
        }
    }

    private static void AddPortableCandidates(List<(string Source, string Path)> values, string? directory, string source)
    {
        if (string.IsNullOrWhiteSpace(directory))
        {
            return;
        }

        Add(values, source, directory);
        Add(values, source, Path.Combine(directory, "web"));
        Add(values, source, Path.Combine(directory, "jellyfin-web"));
    }

    internal static string? ReadWebDirArgument(IReadOnlyList<string> arguments)
    {
        for (var index = 0; index < arguments.Count; index++)
        {
            var argument = arguments[index];
            if (argument.StartsWith("--webdir=", StringComparison.OrdinalIgnoreCase))
            {
                return argument[9..].Trim('"');
            }

            if (argument.Equals("--webdir", StringComparison.OrdinalIgnoreCase) && index + 1 < arguments.Count)
            {
                return arguments[index + 1].Trim('"');
            }
        }

        return null;
    }

    private static JellyfinWebCandidate? Evaluate(string source, string suppliedPath, string currentLoaderPath)
    {
        try
        {
            var full = Path.GetFullPath(suppliedPath);
            var indexPath = Path.GetFileName(full).Equals("index.html", StringComparison.Ordinal)
                ? full
                : Path.Combine(full, "index.html");
            indexPath = Path.GetFullPath(indexPath);
            var webRoot = Path.GetDirectoryName(indexPath)!;
            if (!Path.GetFileName(indexPath).Equals("index.html", StringComparison.Ordinal))
            {
                return null;
            }

            if (!File.Exists(indexPath) || (File.GetAttributes(indexPath) & FileAttributes.Directory) != 0)
            {
                return new(webRoot, indexPath, source, false, false, false, false, false, false, "index_not_found");
            }

            if (!StaysInsideRoot(webRoot, indexPath))
            {
                return new(webRoot, indexPath, source, true, false, false, false, false, false, "symlink_escape");
            }

            string html;
            try
            {
                var info = new FileInfo(indexPath);
                if (info.Length > MaximumIndexBytes)
                {
                    return new(webRoot, indexPath, source, true, false, false, false, false, false, "index_too_large");
                }

                html = File.ReadAllText(indexPath);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return new(webRoot, indexPath, source, true, false, false, false, false, false, "index_not_readable");
            }

            var recognized = IsJellyfinWeb(html);
            var injected = html.Contains(IndexFileService.Marker, StringComparison.OrdinalIgnoreCase);
            var current = IndexFileService.ContainsLoader(html, currentLoaderPath);
            var writable = IsWritable(indexPath);
            return new(webRoot, indexPath, source, true, true, writable, recognized, injected, current,
                recognized ? (writable ? string.Empty : "index_not_writable") : "not_jellyfin_web");
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    internal static bool IsJellyfinWeb(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return false;
        }

        var hasDoctype = html.Contains("<!doctype html", StringComparison.OrdinalIgnoreCase);
        var hasRoot = html.Contains("reactRoot", StringComparison.OrdinalIgnoreCase)
            || html.Contains("dashboardDocument", StringComparison.OrdinalIgnoreCase)
            || html.Contains("class=\"mainAnimatedPages", StringComparison.OrdinalIgnoreCase);
        var hasBundle = html.Contains("main.jellyfin", StringComparison.OrdinalIgnoreCase)
            || html.Contains("jellyfin-apiclient", StringComparison.OrdinalIgnoreCase)
            || html.Contains("runtime.bundle", StringComparison.OrdinalIgnoreCase);
        var hasBodyClose = html.Contains("</body>", StringComparison.OrdinalIgnoreCase);
        return hasDoctype && hasRoot && hasBundle && hasBodyClose;
    }

    private static bool IsWritable(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReadOnly) != 0)
            {
                return false;
            }

            if (!OperatingSystem.IsWindows())
            {
                var mode = File.GetUnixFileMode(path);
                const UnixFileMode writeBits = UnixFileMode.UserWrite | UnixFileMode.GroupWrite | UnixFileMode.OtherWrite;
                if ((mode & writeBits) == 0)
                {
                    return false;
                }
            }

            using var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
            return stream.CanWrite;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            return false;
        }
    }

    private static bool StaysInsideRoot(string root, string file)
    {
        var rootInfo = new DirectoryInfo(root);
        var fileInfo = new FileInfo(file);
        var resolvedRoot = rootInfo.ResolveLinkTarget(true)?.FullName ?? rootInfo.FullName;
        var resolvedFile = fileInfo.ResolveLinkTarget(true)?.FullName ?? fileInfo.FullName;
        var relative = Path.GetRelativePath(resolvedRoot, resolvedFile);
        return !Path.IsPathRooted(relative)
            && !relative.Equals("..", StringComparison.Ordinal)
            && !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal);
    }
}
