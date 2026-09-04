using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.VideoAutoplay
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        public static string ToolVersion => typeof(Plugin).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        public static Plugin Instance { get; private set; } = null!;
        internal static string BasePath { get; private set; } = string.Empty;
        internal static string? ResolvedWebPath { get; private set; }
        internal static string? WebRootPath { get; private set; }

        private readonly ILogger<Plugin> _logger;

        public Plugin(
            IApplicationPaths paths,
            IXmlSerializer serializer,
            ILogger<Plugin> logger,
            IServerConfigurationManager configurationManager
        ) : base(paths, serializer)
        {
            Instance = this;
            _logger = logger;

            // BasePath (يدعم /jellyfin عند العكس)
            try
            {
                var networkConfig = configurationManager.GetConfiguration("network");
                var baseUrlProp = networkConfig.GetType().GetProperty("BaseUrl");
                var confBase = baseUrlProp?.GetValue(networkConfig)?.ToString()?.Trim('/');
                if (!string.IsNullOrEmpty(confBase)) BasePath = "/" + confBase;
            }
            catch (Exception e)
            {
                _logger.LogWarning(e, "[VA] Unable to read BaseUrl; using root.");
            }
            _logger.LogInformation("[VA] BasePath = '{BasePath}'", BasePath);

            // محاولة اكتشاف index.html افتراضيًا (للعرض فقط في /info)
            try
            {
                string? configured = Configuration?.IndexHtmlPath?.Trim();
                string fallbackWebPath = paths.WebPath ?? string.Empty;
                WebRootPath = string.IsNullOrWhiteSpace(fallbackWebPath)
                    ? null
                    : Path.GetFullPath(fallbackWebPath);
                string? indexPath = null;

                if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
                    indexPath = configured;
                else if (!string.IsNullOrWhiteSpace(fallbackWebPath))
                {
                    var candidate = Path.Combine(fallbackWebPath, "index.html");
                    if (File.Exists(candidate)) indexPath = candidate;
                }

                ResolvedWebPath = (indexPath != null) ? Path.GetDirectoryName(indexPath)! : null;
                _logger.LogInformation("[VA] Resolved index.html: {p}", indexPath ?? "(not found)");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[VA] resolve path failed.");
            }
        }

        public override string Name => "Video Autoplay";
        public override string Description => "Injects a hero auto-play section above “مكتبتي” across pages.";
        public override Guid Id => Guid.Parse("f8aab2db-7f0a-4c43-8b6c-9c9a1a3d9e01");

        // تعريض الملفات المضمّنة تحت /web
        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = typeof(Plugin).Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    // صفحة الإعدادات داخل لوحة Jellyfin
                    Name = "VideoAutoplay",
                    EmbeddedResourcePath = $"{ns}.Controllers.configPage.html"
                },
                new PluginPageInfo
                {
                    // يصبح متاحًا عبر /web/VideoAutoplay/loader.js (اختياري، لأننا نوفره أيضًا عبر الكنترولر)
                    Name = "VideoAutoplay/loader.js",
                    EmbeddedResourcePath = $"{ns}.Web.loader.js"
                },
                new PluginPageInfo
                {
                    Name = "VideoAutoplay/media-cache.js",
                    EmbeddedResourcePath = $"{ns}.Web.media-cache.js"
                },
                new PluginPageInfo
                {
                    // /web/VideoAutoplay/video-autoplay.js
                    Name = "VideoAutoplay/video-autoplay.js",
                    EmbeddedResourcePath = $"{ns}.Web.video-autoplay.js"
                }
            };
        }
    }
}
