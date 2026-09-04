using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.VideoAutoplay
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        // لغة واجهة البلجن (تنعكس على صفحة الإعدادات + واجهة الـ Hero)
        // القيم المتوقعة: "ar" | "en"
        public string UiLanguage { get; set; } = "ar";

        public bool Enabled { get; set; } = true;

        // عدد العناصر المعروضة لكل نوع (1–10)
        public int MaxItemsPerType { get; set; } = 5;

        // تفضيل تشغيل Trailers عن بُعد عند توفرها
        public bool PreferRemoteTrailers { get; set; } = true;

        // تشغيل تلقائي بدون صوت
        public bool AutoplayMuted { get; set; } = true;

        // مسار ملف index.html الحقيقي (لأجل الحقن)
        // مثال: /volume1/docker/jellyfin/jellyfin-web/index.html
        public string? IndexHtmlPath { get; set; } = "";

        // عناوين بديلة لبلوك “مكتبتي” (للواجهة الأمامية إن احتجت)
        public string[] AltTitles { get; set; } = new[] { "مكتبتي", "My Library", "المكتبة" };

        // تمكين استخراج رابط مباشر من YouTube عبر yt-dlp (تجريبي)
        public bool EnableYtDirect { get; set; } = false;

        // مسار مطلق لملف yt-dlp التنفيذي. يبقى فارغًا حتى يضبطه المسؤول.
        public string? YtDlpPath { get; set; } = "";

        // تفضيل الحصول على ملف MP4 تقدمي إن أمكن (بدلاً من HLS/DASH)
        public bool YtPreferMp4 { get; set; } = true;

        // إجبار استخدام صيغة YouTube رقم 18 (mp4 360p progressive) لضمان أعلى توافق (اختياري)
        public bool YtForceFormat18 { get; set; } = false;
    }
}
