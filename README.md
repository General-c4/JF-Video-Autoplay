JF Video Autoplay Plugin 1.1.1 RC2
========================

Source repository: https://github.com/General-c4/JF-Video-Autoplay

Release binaries and the Jellyfin repository manifest are maintained separately at https://github.com/General-c4/JF-Video-Autoplay-Releases. Ordinary source pushes run validation only and never publish a release. Publication requires an explicitly approved release-workflow run or matching approved tag. The release workflow requires a fine-grained `DISTRIBUTION_REPO_TOKEN` repository secret with Contents read/write access limited to the distribution repository; stable releases additionally require approval through the protected `production-release` environment or the matching repository variable described in the workflow.

ملحق Jellyfin يعرض منطقة بطول الشاشة (Hero) أعلى قسم "مكتبتي" (أو أية تسمية بديلة تحددها) ويقوم بعرض وتشغيل تلقائي لترايلر (RemoteTrailer) لأول العناصر الجديدة (أفلام / مسلسلات) مع شعاراتها وخلفيات عالية الدقة.

المزايا الرئيسية:
- تشغيل تلقائي صامت (Muted Autoplay) مع إمكانية تفعيل الصوت بالتفاعل.
- دعم YouTube / Vimeo / ملفات فيديو مباشرة (mp4, webm, m3u8) مع كشف دعم HLS والتراجع للصورة عند عدم الدعم.
- تبويب سريع بين أحدث الأفلام وأحدث المسلسلات.
- شريط مصغرات شعارات للتنقل بين العناصر.
- حفظ حالة الصوت والكتم في LocalStorage (استمرارية بين الجلسات).
- تحسينات استقرار: إعادة المحاولة لطلبات الـ API، إيقاف التشغيل عند خروج العنصر من مجال الرؤية (IntersectionObserver)، تجنّب التكرار في الـ SPA.
- دعم جميع الأجهزة والأحجام (سطح المكتب، جوال، شاشات تلفاز، WebViews) مع بدائل في حال غياب بعض واجهات المتصفح.

التركيب (Development Build):
1. ثبّت .NET SDK 9.0.317 ثم ابْنِ المشروع:
	- افتح مجلد `Jellyfin.Plugin.VideoAutoplay` وشغّل:
	  - `dotnet build -c Release`
2. انسخ ملف `Jellyfin.Plugin.VideoAutoplay.dll` من `src/bin/Release/net9.0/` إلى مجلد الإضافات في خادم Jellyfin 10.11 لديك (عادة: `.../plugins/VideoAutoplay/`).
3. أعد تشغيل خادم Jellyfin.

التهيئة:
1. من لوحة الإدارة > Plugins > Video Autoplay.
2. عيِّن (اختياريًا) المسار الكامل لملف `index.html` الأصلي للواجهة (إذا لم يُكتشف تلقائيًا) في الحقل `IndexHtmlPath`.
3. احفظ الإعدادات. يقدّم الملحق ملف `config.js` ديناميكيًا بدون أسرار أو بيانات اعتماد، وتستخدم الواجهة جلسة Jellyfin الحالية للمصادقة.
4. زر (Inject Now) سيقوم بحقن الوسم التالي قبل `</body>` في `index.html`:
	`<script plugin="VideoAutoplay" defer="defer" src="/VideoAutoplay/loader.js"></script>`
5. في حال أردت إزالة الوسم استخدم (Remove Now) أو احذف السطر يدويًا.

ضبط العناوين البديلة للقسم:
في الإعدادات تستطيع تعديل مصفوفة `AltTitles` بحيث ينجح الملحق في إيجاد بلوك المكتبات مهما كانت اللغة الظاهرة.

سلوك الفيديو:
- يبدأ دائمًا مكتومًا (Muted) للسماح بالتشغيل التلقائي على iOS/Android.
- أول تفاعل (لمس / نقرة) يعيد الصوت لمستوى افتراضي (20%).
- يحفظ مستوى الصوت والكتم في LocalStorage (`jfHeroMuted`, `jfHeroVolume`).
- عند وضع التريلر مصدره YouTube يتم التحكم في الصوت عبر postMessage إلى الـ iframe (بدون الحاجة إلى API Key خارجي).

أقصى عدد عناصر:
- حقل `MaxItemsPerType` (1 – 10) يحدد العدد الأقصى للأفلام والمسلسلات المحمّلة. القيمة تُستخدم الآن فعليًا في الواجهة الأمامية (بدلاً من 5 ثابتة).

تحسينات الاستقرار (Backend):
- `config.js` يضيف الآن حقول: `altTitles`, `version` ويمنع التخزين المؤقت (`Cache-Control: no-store`).
- معالجة أخطاء بناء التكوين تعطي كائنًا افتراضيًا معطلًا بدل إسقاط الاستعلام.

تحسينات الاستقرار (Frontend):
- إعادة المحاولة Fetch (حتى 3 مرات مع Backoff) عند فشل الحصول على العناصر.
- تحديث خفيف للوسائط كل 60 ثانية أثناء ظهور الصفحة، وعند العودة للصفحة الرئيسية أو إظهار التبويب، مع زر تحديث يدوي داخل الـ Hero.
- تستخدم صور Jellyfin وسوم `ImageTags` و`BackdropImageTags` أو `DateModified` لتغيير رابط الصورة فقط عندما تتغير الوسائط.
- IntersectionObserver لإيقاف/استئناف التشغيل عندما لا يكون العنصر مرئيًا (توفير طاقة وبطارية).
- Prefetch غير متزامن للشعارات والخلفيات للعناصر التالية بعد التحميل الأولي.
- دعم أوسع لاكتشاف قسم المكتبات (لم يعد يعتمد على أصناف CSS محددة فقط).
- تحسين الاستجابة (Responsive): إزالة الحد الأدنى الصارم للعرض، إضافة استعلامات وسائط إضافية للشاشات الصغيرة.

اعتبارات الأمان:
- لا تُرسَل مفاتيح مشتركة إلى المتصفح، ولا توضع بيانات الاعتماد في عناوين URL. بيانات الميتاداتا تُدرج باستخدام `textContent`.
- ملف `hls.js` المستقر بإصدار 1.7.0 مضمن محليًا ولا يُنزّل ككود تنفيذي وقت التشغيل.
- عمليات الإعدادات والحقن و`yt-dlp` تتطلب صلاحية مسؤول Jellyfin.

اختبارات/تحقق يدوي مقترح:
1. فتح الواجهة الرئيسية بعد الحقن والتأكد من ظهور الـ Hero فوق "مكتبتي".
2. تغيير اللغة (أو عنوان القسم) إلى أحد `AltTitles` وتحقق من استمرار الظهور.
3. تجربة على جوال (Chrome/Android + Safari/iOS) والتأكد من بدء التشغيل مكتومًا ثم رفع الصوت بعد اللمس.
4. تجربة عنصر بتريلر m3u8 في متصفح لا يدعم HLS (اختبر على Firefox سطح المكتب) والتأكد من التراجع إلى الخلفية.
5. إيقاف الشاشة/التمرير للأسفل والتأكد أن الفيديو يوقف التشغيل (IntersectionObserver فعال).

مستقبلًا (أفكار تحسين إضافية):
- دمج hls.js لتشغيل m3u8 في متصفحات بلا دعم أصلي.
- إضافة إعداد واجهة يسمح بتخصيص نسبة الأبعاد أو السماح بملء الشاشة أفقياً.
- دعم أنواع محتوى إضافية (MusicVideo, Episode منفصل، إلخ) مع فلترة.
- إدراج ترجمة/مسارات صوتية عند توافرها (API إضافية).

في حال حدوث مشكلة:
1. افحص السجل في خادم Jellyfin عن أي رسائل `[VA]`.
2. افتح أدوات المطور في المتصفح Console وابحث عن `[VA]`.
3. جرّب استعلام `/VideoAutoplay/info` للتأكد من أن المسارات محلولة.

رخصة: نفس رخصة Jellyfin (ضع الترخيص المناسب هنا إن وجدت).

شكراً لاستخدامك الملحق. مساهماتك مرحب بها.
