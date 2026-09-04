/********* إعدادات من البلجن *********
 * متوافق مع: جميع المتصفحات الحديثة + WebViews لتطبيقات Jellyfin (Android/iOS/TV/Tizen/LG/Windows)
 * ملاحظات التوافق:
 * - الجوال (iOS/Android): يبدأ الفيديو/يوتيوب مكتوم (muted) للسماح بالتشغيل التلقائي، ويُعاد الصوت عند اللمس.
 * - متصفحات لا تدعم aspect-ratio: نحسب الارتفاع يدويًا عبر JS (ResizeObserver/resize).
 * - متصفحات لا تدعم MutationObserver: نستعمل setInterval لمحاولة التركيب.
 * - متصفحات لا تدعم تشغيل HLS (m3u8): نتراجع لصورة الخلفية/iframe إن وُجد.
 *****************************************/
var CFG = window.JF_VA_CONFIG || {};
var ALT_TITLES = (Array.isArray(CFG.altTitles) && CFG.altTitles.length
  ? CFG.altTitles
  : ["مكتبتي","My Library","المكتبة","Library","我的资料库","Моя библиотека"]);
var MAX_ITEMS = (function(m){ m = parseInt(m,10); if(!m||m<1) return 5; return Math.min(10, m); })(CFG.maxItems);
var YT_PREFER_MP4 = !!CFG.ytPreferMp4;
var YT_FORCE_18 = !!CFG.ytForceFormat18;
var MEDIA_CACHE = window.VideoAutoplayCache;
var MEDIA_REFRESH_INTERVAL_MS = 60000;

var UI_LANG = (function(v){
  v = String(v || '').toLowerCase();
  return (v === 'en') ? 'en' : 'ar';
})(CFG.uiLanguage || CFG.UiLanguage);

var I18N = {
  ar: {
    watchNow: 'شاهد الآن',
    muteTitle: 'كتم/تشغيل الصوت',
    audioSource: 'مصدر الصوت',
    movies: 'أفلام',
    series: 'مسلسلات',
    movieType: 'فيلم',
    seriesType: 'مسلسل',
    trailerCantPlay: 'تعذر تشغيل التريلر',
    trailerCantPlayJmp: 'لم يقبل المشغل أمر التشغيل داخل Jellyfin Media Player. جرّب تفعيل yt-direct (MP4) أو جرّب تريلر مختلف.',
    hlsBlocked: 'الرابط HLS (.m3u8) وتم منعه داخل Jellyfin Media Player.',
    ytAudioOnly: 'yt-dlp أعاد صوت فقط (بدون صورة). جرّب تفعيل خيار إجبار صيغة 18 أو حدّث yt-dlp.',
    ytIframeBlocked: 'يوتيوب عبر iframe غير مدعوم داخل Jellyfin Media Player. فعّل yt-direct واضبط yt-dlp للحصول على MP4.',
    ytDirectFailed: 'فشل استخراج رابط مباشر عبر yt-dlp (yt-direct). تأكد من وجود yt-dlp على السيرفر وإعداد مساره في إعدادات البلجن.',
    vimeoIframeBlocked: 'Vimeo عبر iframe غير مدعوم داخل Jellyfin Media Player.',
    noTrailer: 'لا يوجد تريلر',
    noItems: 'لا توجد عناصر.',
    refresh: 'تحديث الوسائط',
    refreshing: 'جارٍ تحديث الوسائط'
  },
  en: {
    watchNow: 'Watch now',
    muteTitle: 'Mute/Unmute',
    audioSource: 'Audio source',
    movies: 'Movies',
    series: 'Series',
    movieType: 'Movie',
    seriesType: 'Series',
    trailerCantPlay: 'Unable to play trailer',
    trailerCantPlayJmp: 'The player rejected autoplay in Jellyfin Media Player. Try enabling yt-direct (MP4) or try a different trailer.',
    hlsBlocked: 'This is an HLS (.m3u8) URL and it is blocked inside Jellyfin Media Player.',
    ytAudioOnly: 'yt-dlp returned audio-only (no video). Try forcing format 18 or update yt-dlp.',
    ytIframeBlocked: 'YouTube via iframe is not supported inside Jellyfin Media Player. Enable yt-direct and configure yt-dlp to get an MP4.',
    ytDirectFailed: 'Failed to extract a direct URL via yt-dlp (yt-direct). Verify yt-dlp is installed on the server and its path is set in plugin settings.',
    vimeoIframeBlocked: 'Vimeo via iframe is not supported inside Jellyfin Media Player.',
    noTrailer: 'No trailer',
    noItems: 'No items found.',
    refresh: 'Refresh media',
    refreshing: 'Refreshing media'
  }
};

function T(key){
  var d = I18N[UI_LANG] || I18N.ar;
  return d[key] || (I18N.ar[key] || key);
}

(function(){
  if (CFG.enabled === false) return;
  if (!window.ApiClient || !MEDIA_CACHE) { try{ console.error('[VA] Authenticated ApiClient or media cache helpers are unavailable'); }catch(_){} return; }

  // Polyfills
  if (!Array.prototype.find) Array.prototype.find = function(fn,thisArg){ for (var i=0;i<this.length;i++){ if(fn.call(thisArg,this[i],i,this)) return this[i]; } };
  if (!String.prototype.includes) String.prototype.includes = function(s,p){ return this.indexOf(s,p||0) !== -1; };

  if (window.__JF_HERO && typeof window.__JF_HERO.dispose === 'function') { try{ window.__JF_HERO.dispose(); }catch(_){} }
  var mo=null, poll=null, orientationTimer=null, mountedOnce=false, hero=null;
  function onHash(){ if (tryMount()) { try{ hero.refresh('navigation'); }catch(_){} } }
  function onResize(){ try{ hero.refreshSize(); }catch(_){} }
  function onOrientation(){ if(orientationTimer) clearTimeout(orientationTimer); orientationTimer=setTimeout(function(){ orientationTimer=null; onResize(); },250); }
  window.__JF_HERO = { dispose:function(){
    try{ mo&&mo.disconnect&&mo.disconnect(); }catch(_){}
    try{ if(poll) clearInterval(poll); }catch(_){}
    try{ if(orientationTimer) clearTimeout(orientationTimer); }catch(_){}
    try{ window.removeEventListener('hashchange', onHash, false); }catch(_){}
    try{ window.removeEventListener('resize', onResize, false); }catch(_){}
    try{ window.removeEventListener('orientationchange', onOrientation, false); }catch(_){}
    try{ hero&&hero.destroy&&hero.destroy(); }catch(_){}
    try{ delete window.__JF_HERO; }catch(_){}
  } };

  function onReady(fn){ if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn, {once:true}); } else { fn(); } }
  onReady(init);

  function init(){
    hero = buildHero();
    tryMount();
    if ('MutationObserver' in window){
      mo = new MutationObserver(function(){ tryMount(); });
      try { mo.observe(document.body,{childList:true,subtree:true}); } catch(_){ }
    } else {
      poll=setInterval(function(){ if (!document.body) return; if (tryMount()){ clearInterval(poll); poll=null;} },700);
    }
    window.addEventListener('hashchange', onHash, false);
    window.addEventListener('resize', onResize, false);
    try { window.addEventListener('orientationchange', onOrientation, false); } catch(_){ }
  }

  // === 1) ابحث عن قسم "مكتبتي" في أي صفحة، مش الهوم فقط ===
  function normalizeText(s){ return String(s||"").replace(/\s+/g," ").trim().toLowerCase(); }
  function findLibrarySection() {
    // broader query to catch future classes
    var sections = document.querySelectorAll('.verticalSection');
    for (var i=0;i<sections.length;i++){
      var sec = sections[i];
      var h2 = sec.querySelector('h2');
      if (!h2) continue;
      var t = normalizeText(h2.textContent||'');
      for (var j=0;j<ALT_TITLES.length;j++){
        if (t === normalizeText(ALT_TITLES[j])) return sec;
      }
    }
    return null;
  }

  // === 2) حضّر الـHero واربطه فوق "مكتبتي" متى ما ظهرت ===
  function tryMount() {
    var host = findLibrarySection();
    if (!host) return false;

    // لا تكرر الإدراج
    if (hero.root.parentElement === host.parentElement && hero.root.nextElementSibling === host) {
      return true;
    }

    try { hero.root.remove(); } catch(_){}
    try { host.parentElement.insertBefore(hero.root, host); } catch(_){ return false; }
    if (!mountedOnce) { try { hero.attach(); mountedOnce = true; } catch(_){ } }
    try { hero.refreshSize(); } catch(_){}
    return true;
  }

  // ===========================
  //       HERO COMPONENT
  // ===========================
  function buildHero(){
  var S = { data:{Movie:[],Series:[]}, type:"Movie", idx:0, mode:"image", iframeSource:null, ytUnmuted:false, ytJsApi:false, renderGeneration:0, refreshGeneration:0, timers:[], intervals:[], objectUrls:[], refreshing:false, destroyed:false, currentMediaKey:'', manualEpochs:Object.create(null) };
  var trailerCache = MEDIA_CACHE.createTrailerCache({ positiveTtl:300000, negativeTtl:15000 });

    // ===== API =====
    var origin = location.origin, pathname = location.pathname || "";
    // أفضل كشف لقاعدة الخادم عبر المسار قبل /web/ لكي يعمل على كل التطبيقات
    var baseFromPath = (function(){
      try {
        if (pathname.indexOf("/web/") !== -1) return (origin + pathname.split("/web/")[0]).replace(/\/+$/,"");
        // clients التي تحمل index من الجذر
        return (origin + (pathname||"")).replace(/\/+$/,"");
      } catch(_){ return origin; }
    })();
    var API_BASE = baseFromPath;

    function build(p,q){
      p = String(p||"").replace(/^\/+/, "");
      var qs = "";
      if (q && typeof q === "object") {
        var sp = new URLSearchParams();
        for (var k in q){ if (Object.prototype.hasOwnProperty.call(q,k) && q[k] !== void 0 && q[k] !== null) sp.append(k, String(q[k])); }
        var s = sp.toString();
        if (s) qs = "?" + s;
      }
      return API_BASE + "/" + p + qs;
    }

    function authHeaders(){
      try {
        var token = ApiClient.accessToken && ApiClient.accessToken();
        return token ? { 'X-Emby-Token': token } : {};
      } catch(_){ return {}; }
    }

    function later(fn, delay){ var id=setTimeout(function(){ S.timers=S.timers.filter(function(x){return x!==id;}); fn(); },delay); S.timers.push(id); return id; }
    function forgetObjectUrl(u){ S.objectUrls=S.objectUrls.filter(function(x){return x!==u;}); try{ URL.revokeObjectURL(u); }catch(_){} }
    function revokeObjectUrls(){ S.objectUrls.forEach(function(u){ try{ URL.revokeObjectURL(u); }catch(_){} }); S.objectUrls=[]; }
    function setAuthenticatedImage(img, path, query, generation){
      return fetch(build(path, query), { headers:authHeaders(), cache:'force-cache' }).then(function(r){ if(!r.ok) throw new Error('image '+r.status); return r.blob(); }).then(function(blob){
        if (generation !== S.renderGeneration || S.destroyed) return;
        var objectUrl=URL.createObjectURL(blob), old=img._vaObjectUrl, probe=new Image(); S.objectUrls.push(objectUrl);
        probe.onload=function(){
          if(generation!==S.renderGeneration || S.destroyed){ forgetObjectUrl(objectUrl); return; }
          img._vaObjectUrl=objectUrl; img.src=objectUrl; if(old) forgetObjectUrl(old);
        };
        probe.onerror=function(){ forgetObjectUrl(objectUrl); };
        probe.src=objectUrl;
      }).catch(function(){});
    }
    function prefetchAuthenticatedImage(path, query){
      return fetch(build(path, query), { headers:authHeaders(), cache:'force-cache' }).catch(function(){});
    }

    function isVideo(u){ return /\.(mp4|webm)(\?|#|$)/i.test(u) || /\.m3u8(\?|#|$)/i.test(u); }
    function isYT(u){ return /youtube\.com|youtu\.be/i.test(u); }
    function isVimeo(u){ return /vimeo\.com/i.test(u); }
    function ytId(u){
      var m = u.match(/v=([^&]+)/) || u.match(/youtu\.be\/([^?]+)/) || u.match(/embed\/([^?]+)/);
      return m ? m[1] : null;
    }
    function safeOriginForYt(){
      try {
        if (/^https?:\/\//i.test(origin || "")) return origin;
      } catch(_){ }
      return "";
    }
    function ytEmbed(id){
      // ملاحظة: loop مع يوتيوب يتطلب playlist=VIDEO_ID
      // نستخدم nocookie لتحسين التوافق داخل WebViews
      var so = safeOriginForYt();
      var q = [
        "autoplay=1",
        "mute=1",
        "controls=0",
        "rel=0",
        "modestbranding=1",
        "playsinline=1",
        "loop=1",
        "playlist=" + encodeURIComponent(id),
        "iv_load_policy=3",
        "fs=0",
        "disablekb=1"
      ];
      if (so){
        q.push("enablejsapi=1");
        q.push("origin=" + encodeURIComponent(so));
      } else {
        // إن لم نكن داخل http/https لا نفعّل JS API لتجنب أخطاء التهيئة
        q.push("enablejsapi=0");
      }
      return "https://www.youtube-nocookie.com/embed/" + id + "?" + q.join("&");
    }
    function imagePath(id,type){ return "Items/"+encodeURIComponent(id)+"/Images/"+type; }
    function imageQuery(item,type,dimensions){ return MEDIA_CACHE.imageQuery(item,type,dimensions,S.manualEpochs[item.Id]||0); }
    function setAuthenticatedBackground(item,generation){
      var query=imageQuery(item,'Backdrop',{ fillWidth:3840, height:2160, quality:90 });
      return fetch(build(imagePath(item.Id,'Backdrop'), query), { headers:authHeaders(), cache:'force-cache' })
        .then(function(r){ if(!r.ok) throw new Error('backdrop '+r.status); return r.blob(); })
        .then(function(blob){
          if(generation!==S.renderGeneration || S.destroyed) return;
          var u=URL.createObjectURL(blob), old=root._vaObjectUrl, probe=new Image(); S.objectUrls.push(u);
          probe.onload=function(){ if(generation!==S.renderGeneration || S.destroyed){ forgetObjectUrl(u); return; } root._vaObjectUrl=u; root.style.backgroundImage='url("'+u+'")'; if(old) forgetObjectUrl(old); };
          probe.onerror=function(){ forgetObjectUrl(u); };
          probe.src=u;
        })
        .catch(function(){});
    }

    function canPlayHLS(videoEl){
      try {
        if (videoEl && typeof videoEl.canPlayType === "function") {
          var t = videoEl.canPlayType("application/vnd.apple.mpegurl");
          return !!t;
        }
      } catch(_){}
      return false;
    }

    // كشف بيئة Jellyfin Media Player (Desktop) / Electron / MPV WebView
    function isJellyfinMediaPlayer(){
      try {
        if (window.process && window.process.versions && window.process.versions.electron) return true;
      } catch(_){ }
      try {
        var ua = navigator.userAgent || "";
        // JMP يضيف غالبًا هذا النص
        if (/Jellyfin Media Player/i.test(ua)) return true;
        if (/Electron/i.test(ua)) return true;
      } catch(_){ }
      return false;
    }

    // وضع خاص: داخل Jellyfin Media Player نمنع HLS و iframe
    var IS_JMP = isJellyfinMediaPlayer();

    // تحميل hls.js عند الحاجة فقط (كاش Promise)
    var _hlsLoadPromise = null;
    function ensureHls(){
      if (window.Hls) return Promise.resolve(window.Hls);
      if (_hlsLoadPromise) return _hlsLoadPromise;
      _hlsLoadPromise = new Promise(function(res, rej){
        var s = document.createElement('script');
        s.src = build('VideoAutoplay/hls.min.js');
        s.onload = function(){ if (window.Hls) res(window.Hls); else rej(new Error('hls.js loaded but Hls undefined')); };
        s.onerror = function(){ rej(new Error('Failed to load hls.js')); };
        document.head.appendChild(s);
      });
      return _hlsLoadPromise;
    }

    function getLatest(type){
      var attempt = 0;
      var limit = MAX_ITEMS;
      function exec(){
        attempt++;
        return fetch(build("Items", {
          IncludeItemTypes: type,
          Recursive: "true",
          Limit: String(limit),
          SortBy: "DateCreated",
          SortOrder: "Descending",
          Fields: "PrimaryImage,Overview,ProductionYear,RemoteTrailers,DateCreated,DateModified,RunTimeTicks,Genres,Studios,ImageTags,BackdropImageTags,ParentBackdropImageTags,MediaSources"
        }), { headers:authHeaders(), cache:'no-store' }).then(function(r){
          if (!r.ok) throw new Error("GET "+type+" -> "+r.status);
          return r.json();
        }).then(function(j){
          var arr = j && (j.Items || j) || [];
          try { arr.sort(function(a,b){ return new Date(b.DateCreated||0) - new Date(a.DateCreated||0); }); } catch(_){ }
          return arr.slice(0, limit);
        }).catch(function(e){
          if (attempt < 3) return new Promise(function(res){ later(function(){ res(exec()); }, 350*attempt); });
          throw e;
        });
      }
      return exec();
    }

    function resolveTeaser(item){
      if (CFG.preferRemoteTrailers === false) return Promise.resolve({kind:"none", reason:"remote_trailers_disabled"});
      var u = item && item.RemoteTrailers && item.RemoteTrailers[0] && item.RemoteTrailers[0].Url;
      if (!u) return Promise.resolve({kind:"none", reason:"no_trailer"});

      // داخل JMP: لا تستخدم HLS (m3u8) لأنه لا يعمل جيدًا في <video>
      if (isVideo(u)) {
        var isHlsUrl = /\.m3u8(\?|#|$)/i.test(u);
        if (IS_JMP && isHlsUrl) return Promise.resolve({ kind:"none", reason:"hls_blocked_in_jmp" });
        return Promise.resolve({kind:"video", url:u});
      }

      // YouTube → محاولة استخراج رابط مباشر عبر yt-dlp endpoint إن مُفعل
      if (isYT(u)){
        var id = ytId(u);
        if (!id) return Promise.resolve({kind:"none", reason:"yt_no_id"});
        var ytJsApi = !!safeOriginForYt();

        function looksAudioOnly(resp){
          try {
            var ext = (resp && resp.ext) ? String(resp.ext).toLowerCase() : '';
            if (ext && /^(m4a|mp3|aac|opus|ogg|webm)$/i.test(ext) && ext !== 'mp4') return true;
            if (ext === 'm4a') return true;
          } catch(_){ }
          try {
            var url = (resp && resp.url) ? String(resp.url) : '';
            if (/mime=audio\//i.test(url)) return true;
            if (/\btype=audio\b/i.test(url)) return true;
          } catch(_){ }
          return false;
        }

        function fetchYtDirect(mode){
          var ytApi = API_BASE + "/VideoAutoplay/yt-direct?mode="+mode+"&u="+encodeURIComponent(u);
          return fetch(ytApi, { headers:authHeaders(), cache:'no-store' })
            .then(function(r){ if(!r.ok) throw new Error("ytDirect status "+r.status); return r.json(); });
        }

        // داخل JMP: لا نسمح بالـ iframe؛ نحاول yt-direct حتى لو لم يُفعل الخيار صراحةً
        var allowYtDirect = !!CFG.enableYtDirect || IS_JMP;
        if (allowYtDirect){
          var primaryMode = YT_FORCE_18 ? "18" : (YT_PREFER_MP4?"mp4":"hls");
          if (IS_JMP) primaryMode = (YT_FORCE_18 ? "18" : "mp4");

          return fetchYtDirect(primaryMode)
            .then(function(j){
              if (j && j.ok && j.url){
                // داخل JMP: لو رجع HLS نتجاهله
                if (IS_JMP && (j.isHls || /\.m3u8(\?|#|$)/i.test(j.url))) return { kind:"none", reason:"yt_direct_returned_hls" };
                // داخل JMP: لو رجع صوت فقط، أعد المحاولة بصيغة 18
                if (IS_JMP && primaryMode !== '18' && looksAudioOnly(j)){
                  return fetchYtDirect('18').then(function(j2){
                    if (j2 && j2.ok && j2.url){
                      if (j2.isHls || /\.m3u8(\?|#|$)/i.test(j2.url)) return { kind:"none", reason:"yt_direct_returned_hls" };
                      if (looksAudioOnly(j2)) return { kind:"none", reason:"yt_direct_audio_only" };
                      return { kind:"video", url: j2.url, hls: !!j2.isHls, headers: j2.headers||null };
                    }
                    return { kind:"none", reason:"yt_direct_not_ok" };
                  }).catch(function(){
                    return { kind:"none", reason:"yt_direct_failed" };
                  });
                }
                if (IS_JMP && looksAudioOnly(j)) return { kind:"none", reason:"yt_direct_audio_only" };
                return { kind:"video", url: j.url, hls: !!j.isHls, headers: j.headers||null };
              }
              return IS_JMP
                ? { kind:"none", reason:"yt_direct_not_ok" }
                : { kind:"iframe", url: ytEmbed(id), source:"youtube", videoId:id, ytJsApi: ytJsApi };
            })
            .catch(function(){
              return IS_JMP
                ? { kind:"none", reason:"yt_direct_failed" }
                : { kind:"iframe", url: ytEmbed(id), source:"youtube", videoId:id, ytJsApi: ytJsApi };
            });
        }
        return IS_JMP
          ? Promise.resolve({ kind:"none", reason:"yt_iframe_blocked_in_jmp" })
          : Promise.resolve({kind:"iframe", url: ytEmbed(id), source:"youtube", videoId:id, ytJsApi: ytJsApi});
      }
      if (isVimeo(u)){
        if (IS_JMP) return Promise.resolve({ kind:"none", reason:"vimeo_iframe_blocked_in_jmp" });
        var e = u.indexOf("player.vimeo.com")>-1
          ? (u + (u.indexOf("?")>-1 ? "&" : "?") + "autoplay=1&muted=1&loop=1&background=1")
          : ("https://player.vimeo.com/video/" + u.split("/").pop() + "?autoplay=1&muted=1&loop=1&background=1");
        return Promise.resolve({kind:"iframe", url:e, source:"vimeo"});
      }
      return Promise.resolve({kind:"none", reason:"unsupported_trailer"});
    }

    function teaserOf(item){
      var key=MEDIA_CACHE.trailerKey(item,CFG,IS_JMP), cached=trailerCache.get(key);
      if(cached) return Promise.resolve(cached);
      return resolveTeaser(item).then(function(result){ trailerCache.put(key,result); return result; });
    }

    function fmtTime(t){
      try {
        if (!t) return "";
        var s = Math.floor(Number(t)/10000000);
        var h = (s/3600)|0, m = ((s%3600)/60)|0, sec=(s%60)|0;
        return h ? (pad2(h)+":"+pad2(m)+":"+pad2(sec)) : (pad2(m)+":"+pad2(sec));
      } catch(_){ return ""; }
    }
    function pad2(n){ n = Number(n)||0; return (n<10?"0":"")+n; }

    // ===== Styles =====
    var styleEl = document.createElement("style");
    styleEl.textContent = ""
      + ".sh-hero{--va-scale:1;--va-font-scale:1;position:relative;width:100%;max-width:1910px;overflow:hidden;border-radius:14px;margin:16px auto;background:#0f141a;aspect-ratio:16/5.5;font-size:calc(16px * var(--va-font-scale));}"
      + "@media (max-width:1480px){.sh-hero{max-width:100%}}"
      + "@media (max-width:680px){.sh-hero{margin:8px auto;border-radius:10px}}"
      + ".no-aspect .sh-hero{height:calc(var(--sh-width, 1000px)/(16/5.5));}"
      + ".sh-bg{position:absolute;inset:0}"
      + ".sh-video,.sh-iframe{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border:0;background:#000}"
      + ".sh-video{display:none;opacity:0;transition:opacity .45s}"
      + ".sh-iframe{display:none;opacity:0;transition:opacity .45s}"
      + ".sh-gradB{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(24,29,37,0) 35%,rgba(24,29,37,.55) 78%,#181d25 100%)}"
      + ".sh-panel{position:absolute; right:3%; top:50%; transform:translateY(-50%);width:min(540px,42%); z-index:3; color:#e7eef7; display:flex; flex-direction:column; gap:calc(12px * var(--va-scale));}"
      + ".sh-panel.dimmed{ opacity:.5; transition:opacity .25s ease;}"
      + ".sh-panel:hover{ opacity:1; }"
      + ".sh-logo{max-width:calc(420px * var(--va-scale));max-height:calc(120px * var(--va-scale));object-fit:contain;filter:drop-shadow(0 6px 18px rgba(0,0,0,.55))}"
      + ".sh-meta{display:flex;flex-wrap:wrap;align-items:center;gap:calc(14px * var(--va-scale));color:#b9c6d3;font-weight:700;font-size:calc(14px * var(--va-font-scale));}"
      + ".sh-dot::before{content:\"•\";margin:0 6px;color:#38bdf8}"
      + ".sh-over{color:#d9e3ee;opacity:.96;margin:4px 0 8px;line-height:1.6;max-height:6.4em;overflow:hidden;text-shadow:0 1px 2px rgba(0,0,0,.35);font-size:calc(14px * var(--va-font-scale));}"
      + ".sh-cta{display:inline-flex;align-items:center;gap:calc(10px * var(--va-scale));background:rgba(255,255,255,.08);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:calc(6px * var(--va-scale)) calc(12px * var(--va-scale));cursor:pointer;width:fit-content;font-size:calc(14px * var(--va-font-scale));}"
      + ".sh-cta .play{display:inline-flex;align-items:center;justify-content:center;width:calc(28px * var(--va-scale));height:calc(28px * var(--va-scale));border-radius:50%;background:linear-gradient(90deg,#0C9,#09F)}"
      + ".sh-mute{position:absolute;left:16px;top:16px;z-index:4}"
      + ".sh-mute .btn{display:flex;align-items:center;justify-content:center;width:calc(40px * var(--va-scale));height:calc(40px * var(--va-scale));border-radius:12px;background:#1b2430b3;border:1px solid rgba(0,255,204,.35);cursor:pointer;padding:0}"
      + ".sh-mute .btn svg{width:calc(22px * var(--va-scale));height:calc(22px * var(--va-scale));fill:#44ffe2;filter:drop-shadow(0 0 4px rgba(0,255,204,.4))}"
      + ".sh-audio{position:absolute;left:16px;top:calc(66px * var(--va-scale));z-index:4;display:none;align-items:center;gap:10px;background:#1b2430b3;border:1px solid rgba(255,255,255,.2);padding:8px 10px;border-radius:10px;font-size:12px}"
      + ".sh-audio .lbl{color:#fff;font-size:12px;white-space:nowrap;opacity:.95}"
      + ".sh-audio select{max-width:200px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:4px 8px}"
      + ".sh-hint{position:absolute;left:16px;bottom:16px;z-index:5;display:none;max-width:min(680px,70%);background:rgba(27,36,48,.78);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(10px);color:#fff;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.45}"
      + ".sh-hint b{color:#e7eef7}"
      + ".sh-tabs{position:absolute;top:16px;right:16px;z-index:4;display:flex;gap:8px}"
      + ".sh-tab{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 12px;border-radius:999px;cursor:pointer;font-weight:700;font-size:calc(13px * var(--va-font-scale));}"
      + ".sh-tab.active{background:#fff;color:#0b1220}"
      + ".sh-refresh{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border-radius:50%;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;cursor:pointer}"
      + ".sh-refresh svg{width:18px;height:18px;fill:currentColor}.sh-refresh.loading svg{animation:va-spin .8s linear infinite}.sh-refresh:disabled{opacity:.55;cursor:wait}@keyframes va-spin{to{transform:rotate(360deg)}}"
      + ".sh-strip{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:calc(36px * var(--va-scale));align-items:end}"
      + ".sh-logo-item{opacity:.45;filter:drop-shadow(0 6px 16px rgba(0,0,0,.45));transition:opacity .25s, transform .25s}"
      + ".sh-logo-item img{max-height:calc(50px * var(--va-scale));max-width:calc(200px * var(--va-scale));object-fit:contain;transition:filter .25s}"
      + ".sh-logo-item.active{opacity:1;transform:translateY(-6px)}"
      + "@media (max-width: 850px){.sh-panel{right:6%;top:auto;bottom:22px;transform:none;width:88%;gap:10px}.sh-logo{max-width:62vw;max-height:64px}.sh-over{max-height:5.2em}.sh-strip{gap:16px;bottom:6px}.sh-logo-item img{max-height:32px;max-width:120px}.sh-mute{left:10px;top:10px}.sh-tabs{top:10px;right:10px}.sh-hero{border-radius:10px}}";
    try { document.head.appendChild(styleEl); } catch(_){}

    // ===== DOM =====
  var root = document.createElement("section"); root.className="sh-hero"; root.setAttribute('role','complementary');
    var bg = document.createElement("div"); bg.className="sh-bg";
    var video = document.createElement("video"); video.className="sh-video";
    video.playsInline = true; video.setAttribute("playsinline","");
    video.loop = true; video.autoplay = true;
    // لتمكين التشغيل التلقائي على الجوال: ابدأ مكتوم
    video.muted = CFG.autoplayMuted !== false;
    video.preload = "auto";
  var iframe = document.createElement("iframe"); iframe.className="sh-iframe";
    iframe.setAttribute("allow","autoplay; encrypted-media; picture-in-picture; fullscreen");
    try { iframe.setAttribute("referrerpolicy","origin-when-cross-origin"); } catch(_){ }
  // دعم iOS (Safari) inline
  try { video.setAttribute('webkit-playsinline',''); } catch(_){ }
    bg.appendChild(video); bg.appendChild(iframe);

    var gradB = document.createElement("div"); gradB.className="sh-gradB";

    // اللوحة (يمين، وسط عموديًا/أسفل بالجوال)
    var panel = document.createElement("div"); panel.className="sh-panel";
    var logo = new Image(); logo.className="sh-logo"; logo.alt = "العنوان";
    var meta = document.createElement("div"); meta.className="sh-meta";
    var over = document.createElement("div"); over.className="sh-over";
    var cta = document.createElement("button"); cta.className="sh-cta";
    cta.innerHTML = '<span class="play"><img alt="▶" src="https://shahid.mbc.net/staticFiles/production/static/images/icons/ShowPage/newplayicon.svg" style="width:22px;height:22px"></span><span class="txt" style="font-weight:800"></span>';
    try { cta.querySelector('.txt').textContent = T('watchNow'); } catch(_){ }
    panel.appendChild(logo); panel.appendChild(meta); panel.appendChild(over); panel.appendChild(cta);

    // الصوت
  var muteWrap = document.createElement("div"); muteWrap.className="sh-mute";
  var muteBtn = document.createElement("button"); muteBtn.className="btn"; muteBtn.title=T('muteTitle'); muteBtn.setAttribute('aria-label',T('muteTitle'));
  // أيقونات SVG مضمّنة (بدون اعتماد خارجي)
  var ICON_VOL_MUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm13.5 3a3.5 3.5 0 0 0-2.02-3.17v6.34A3.5 3.5 0 0 0 17.5 12z"/></svg>';
  var ICON_VOL_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm7 0v6a3 3 0 0 0 0-6zm4.5 3a4.5 4.5 0 0 0-2.6-4.09v8.18A4.5 4.5 0 0 0 15.5 12zm3.5 0a8 8 0 0 0-4.5-7.16v2.21A5.5 5.5 0 0 1 18 12a5.5 5.5 0 0 1-3.5 5.05v2.21A8 8 0 0 0 19 12z"/></svg>';
  muteBtn.innerHTML = ICON_VOL_MUTE;
    muteWrap.appendChild(muteBtn);

    // اختيار مصدر/مسار الصوت (عند توفر أكثر من مسار)
    var audioWrap = document.createElement('div'); audioWrap.className = 'sh-audio';
    var audioLbl = document.createElement('span'); audioLbl.className = 'lbl'; audioLbl.textContent = T('audioSource');
    var audioSel = document.createElement('select');
    audioWrap.appendChild(audioLbl);
    audioWrap.appendChild(audioSel);

    // تلميح/تشخيص بسيط (مفيد جدًا داخل Jellyfin Media Player)
    var hint = document.createElement('div');
    hint.className = 'sh-hint';

    // تبويب أفلام/مسلسلات
    var tabs = document.createElement("div"); tabs.className="sh-tabs";
    var tabM = document.createElement("button"); tabM.className="sh-tab"; tabM.textContent=T('movies');
    var tabS = document.createElement("button"); tabS.className="sh-tab"; tabS.textContent=T('series');
    var refreshBtn = document.createElement("button"); refreshBtn.className="sh-refresh"; refreshBtn.title=T('refresh'); refreshBtn.setAttribute('aria-label',T('refresh'));
    refreshBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.9 9h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
    tabs.appendChild(refreshBtn); tabs.appendChild(tabM); tabs.appendChild(tabS);

    // شريط الشعارات
    var strip = document.createElement("div"); strip.className="sh-strip";
    var stripSlots = [];
    for (var si=0; si<MAX_ITEMS; si++){
      var d = document.createElement("div"); d.className="sh-logo-item";
      var im = new Image(); d.appendChild(im); strip.appendChild(d);
      stripSlots.push({box:d,img:im});
    }

    root.appendChild(bg); root.appendChild(gradB); root.appendChild(panel); root.appendChild(muteWrap); root.appendChild(audioWrap); root.appendChild(hint); root.appendChild(tabs); root.appendChild(strip);

    // ===== لوجيك التبويب =====
    function updateTabs(){
      if (S.type === "Movie"){ tabM.classList.add("active"); tabS.classList.remove("active"); }
      else { tabS.classList.add("active"); tabM.classList.remove("active"); }
    }
    tabM.onclick = function(){ if(S.data.Movie.length && S.type!=="Movie"){ S.type="Movie"; updateTabs(); render(0); } };
    tabS.onclick = function(){ if(S.data.Series.length && S.type!=="Series"){ S.type="Series"; updateTabs(); render(0); } };

    // ===== الصوت =====
    var LS_MUTE="jfHeroMuted", LS_VOL="jfHeroVolume";

    function hideAudioSourceUi(){ try { audioWrap.style.display = 'none'; audioSel.innerHTML = ''; } catch(_){ } }

    function audioProvider(){
      try {
        if (S._hlsInstance && Array.isArray(S._hlsInstance.audioTracks) && S._hlsInstance.audioTracks.length){
          return { type: 'hls', tracks: S._hlsInstance.audioTracks };
        }
      } catch(_){ }
      try {
        var ats = video.audioTracks;
        if (ats && typeof ats.length === 'number') return { type: 'native', tracks: ats };
      } catch(_){ }
      return null;
    }

    function trackLabel(tr, idx){
      try {
        if (!tr) return T('audioSource') + ' #' + (idx + 1);
        // hls.js
        if (typeof tr.name === 'string' && tr.name) return tr.name;
        // native AudioTrack
        var lbl = (tr.label || '').trim();
        var lang = (tr.language || '').trim();
        if (lbl && lang) return lbl + ' (' + lang + ')';
        if (lbl) return lbl;
        if (lang) return lang;
      } catch(_){ }
      return 'Track ' + (idx + 1);
    }

    function applySelectedTrack(index){
      index = parseInt(index, 10);
      if (isNaN(index) || index < 0) index = 0;
      var p = audioProvider();
      if (!p || !p.tracks || p.tracks.length <= 1) return;
      try {
        if (p.type === 'hls') {
          if (typeof S._hlsInstance.audioTrack === 'number' || typeof S._hlsInstance.audioTrack === 'string') {
            S._hlsInstance.audioTrack = index;
          }
        } else {
          for (var i = 0; i < p.tracks.length; i++) {
            try { p.tracks[i].enabled = (i === index); } catch(_){ }
          }
        }
        S.audioTrackIndex = index;
      } catch(_){ }
    }

    function refreshAudioSourceUi(){
      if (IS_JMP) { hideAudioSourceUi(); return; }
      if (S.mode !== 'video') { hideAudioSourceUi(); return; }
      var p = audioProvider();
      if (!p || !p.tracks || p.tracks.length <= 1) { hideAudioSourceUi(); return; }

      try {
        audioLbl.textContent = T('audioSource');
        audioSel.innerHTML = '';
        var selected = (typeof S.audioTrackIndex === 'number') ? S.audioTrackIndex : 0;
        if (p.type === 'hls') {
          if (typeof S._hlsInstance.audioTrack === 'number') selected = S._hlsInstance.audioTrack;
        } else {
          for (var j = 0; j < p.tracks.length; j++) {
            if (p.tracks[j] && p.tracks[j].enabled) { selected = j; break; }
          }
        }
        for (var k = 0; k < p.tracks.length; k++) {
          var opt = document.createElement('option');
          opt.value = String(k);
          opt.textContent = trackLabel(p.tracks[k], k);
          audioSel.appendChild(opt);
        }
        audioWrap.style.display = 'flex';
        audioSel.value = String(Math.max(0, Math.min(p.tracks.length - 1, selected)));
        applySelectedTrack(audioSel.value);
      } catch(_){ }
    }

    function loadLocalAudio(){
      var m = null, v = null;
      try { m = localStorage.getItem(LS_MUTE); v = localStorage.getItem(LS_VOL); } catch(_){}
      // داخل JMP: نجبر الكتم دائمًا لتجنب مشاكل الصوت/سياسات التشغيل
      var muted = IS_JMP ? true : (m===null ? CFG.autoplayMuted !== false : m==="1");
      var vol = (v===null ? 0.2 : Math.min(1, Math.max(0, parseFloat(v))));
      video.muted = muted; video.volume = vol;
      updateAudioIcon();
    }
    function saveLocalAudio(){
      if (IS_JMP) return;
      try {
        localStorage.setItem(LS_MUTE, video.muted ? "1":"0");
        localStorage.setItem(LS_VOL, String(video.volume||0));
      } catch(_){}
    }
    function ytPost(func,args){
      try {
        if (!S.ytJsApi) return;
        var payload = JSON.stringify({ event:"command", func:func, args: (args||[]) });
        var tgt = "*";
        try {
          var src = iframe.getAttribute('src') || '';
          if (src.indexOf('youtube-nocookie.com') > -1) tgt = 'https://www.youtube-nocookie.com';
          else if (src.indexOf('youtube.com') > -1) tgt = 'https://www.youtube.com';
        } catch(_){ }
        iframe.contentWindow.postMessage(payload, tgt);
      } catch(_){}
    }
    function ytApplyVolume(){
      // deprecated: slider removed
      ytPost("setVolume",[20]);
      ytPost("unMute");
      S.ytUnmuted = true;
    }

    function ytSetDefaultVolume(){
      try { ytPost("setVolume", [20]); } catch(_){ }
    }

    function isActuallyMuted(){
      if (S.mode === 'video') return video.muted || (video.volume === 0);
      if (S.mode === 'iframe' && S.iframeSource === 'youtube') return !S.ytUnmuted;
      return true;
    }
    function updateAudioIcon(){
      try { muteBtn.innerHTML = isActuallyMuted() ? ICON_VOL_MUTE : ICON_VOL_ON; } catch(_){ }
    }
    function toggleMute(){
      if (S.mode === "video"){
        if (IS_JMP) return;
        video.muted = !video.muted;
        if (!video.muted && video.paused) { try{ video.play(); }catch(_){} }
        saveLocalAudio();
        updateAudioIcon();
      } else if (S.mode === "iframe" && S.iframeSource === "youtube"){
        if (!S.ytJsApi) return;
        if (S.ytUnmuted){ ytPost("mute"); S.ytUnmuted=false; }
        else { ytSetDefaultVolume(); ytPost("unMute"); S.ytUnmuted = true; }
        updateAudioIcon();
      }
    }

    function onUserGesture() {
      // بعض المنصات تشترط تفاعل المستخدم لإلغاء الكتم
      if (S.mode === "video" && video.muted){
        if (IS_JMP) { setDimmed(true); return; }
        video.muted = false;
        if (video.volume === 0) { video.volume = 0.2; }
        saveLocalAudio();
        try { video.play(); } catch(_){}
        updateAudioIcon();
      } else if (S.mode === "iframe" && S.iframeSource === "youtube"){
        if (!S.ytJsApi) return;
        ytPost("unMute"); ytPost("playVideo");
        ytSetDefaultVolume();
        S.ytUnmuted = true;
        updateAudioIcon();
      }
      setDimmed(true);
    }

    // الماوس + اللمس
    muteBtn.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); toggleMute(); }, false);
    audioSel.addEventListener('change', function(e){
      try { e.stopPropagation(); } catch(_){ }
      applySelectedTrack(audioSel.value);
    }, false);

    // ===== تنقل إلى التفاصيل =====
    function goDetails(it){ try { location.hash = "#!/details?id=" + encodeURIComponent(it.Id); } catch(_){} }
    function current(){ return S.data[S.type][S.idx]; }
    function genreOf(it){
      var g = it && it.Genres && it.Genres[0]; if (g) return g;
      if (it && Array.isArray(it.Studios) && it.Studios[0] && it.Studios[0].Name) return it.Studios[0].Name;
      return "";
    }
    cta.addEventListener("click", function(e){ e.preventDefault(); var it = current(); if (it) goDetails(it); }, false);

    // ===== تعتيم اللوحة مع التشغيل =====
    function setDimmed(on){ if (on) panel.classList.add("dimmed"); else panel.classList.remove("dimmed"); }

    function setHint(html){
      try {
        if (!html){ hint.style.display = 'none'; hint.innerHTML = ''; return; }
        hint.innerHTML = html;
        hint.style.display = 'block';
      } catch(_){ }
    }

    function hintForReason(reason){
      if (!IS_JMP) return '';
      if (reason === 'hls_blocked_in_jmp' || reason === 'yt_direct_returned_hls'){
        return '<b>' + T('trailerCantPlay') + '</b><br>' + T('hlsBlocked');
      }
      if (reason === 'yt_direct_audio_only'){
        return '<b>' + T('trailerCantPlay') + '</b><br>' + T('ytAudioOnly');
      }
      if (reason === 'yt_iframe_blocked_in_jmp'){
        return '<b>' + T('trailerCantPlay') + '</b><br>' + T('ytIframeBlocked');
      }
      if (reason === 'yt_direct_failed' || reason === 'yt_direct_not_ok'){
        return '<b>' + T('trailerCantPlay') + '</b><br>' + T('ytDirectFailed');
      }
      if (reason === 'vimeo_iframe_blocked_in_jmp'){
        return '<b>' + T('trailerCantPlay') + '</b><br>' + T('vimeoIframeBlocked');
      }
      if (reason === 'no_trailer'){
        return '<b>' + T('noTrailer') + '</b>';
      }
      return '';
    }

    function playWithRetry(token){
      var attempt = 0;
      function tryPlay(){
        if (token !== S._playToken) return;
        attempt++;
        var p = null;
        try { p = video.play(); } catch(_){ }
        var ok = function(){ if (token !== S._playToken) return; setDimmed(true); };
        var fail = function(){
          if (token !== S._playToken) return;
          if (attempt >= 6){
            setHint('<b>' + T('trailerCantPlay') + '</b><br>' + T('trailerCantPlayJmp'));
            return;
          }
          later(tryPlay, 180 * attempt);
        };
        if (p && typeof p.then === 'function') p.then(ok).catch(fail);
        else later(function(){ if (!video.paused) ok(); else fail(); }, 240);
      }
      tryPlay();
    }

    function disposeMedia(){
      S._playToken=(S._playToken||0)+1;
      try { if (S._hlsInstance && S._hlsInstance.destroy) S._hlsInstance.destroy(); } catch(_){} S._hlsInstance=null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch(_){}
      try { iframe.src='about:blank'; } catch(_){}
      video.style.display='none'; video.style.opacity='0'; iframe.style.display='none'; iframe.style.opacity='0';
      S.mode='image'; S.iframeSource=null; S.ytUnmuted=false; S.ytJsApi=false; hideAudioSourceUi();
    }

    function mediaKey(t){ return [t&&t.kind||'none',t&&t.url||'',t&&t.hls?'hls':'',t&&t.source||''].join('|'); }

    // ===== العرض الرئيسي =====
    function render(idx){
      S.renderGeneration++;
      var generation = S.renderGeneration;
      idx = (typeof idx==="number"?idx:0);
      var list = S.data[S.type]; if(!list || !list.length) return;
      S.idx = ((idx % list.length) + list.length) % list.length;
      var it = list[S.idx];

      // تعبئة اللوحة
      logo.alt = it.Name||"";
      setAuthenticatedImage(logo, imagePath(it.Id,'Logo'), imageQuery(it,'Logo',{ fillWidth:1200, quality:90 }), generation);
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      [S.type==="Movie"?T('movieType'):T('seriesType'), it.ProductionYear||'', it.RunTimeTicks?fmtTime(it.RunTimeTicks):'', genreOf(it)].forEach(function(value,index){
        if(!value) return; var span=document.createElement('span'); if(index>0) span.className='sh-dot'; span.textContent=String(value); meta.appendChild(span);
      });
      over.textContent = it.Overview || "";
      setDimmed(false);
      setHint('');

      // حمّل الخلفية الجديدة أولاً، وأبقِ القديمة إن فشل التحميل.
      setAuthenticatedBackground(it,generation);
      root.style.backgroundSize = "cover"; root.style.backgroundPosition = "center";

      // شريط الشعارات
      var n = Math.min(stripSlots.length, list.length);
      for (var k=0;k<n;k++){
        setAuthenticatedImage(stripSlots[k].img, imagePath(list[k].Id,'Logo'), imageQuery(list[k],'Logo',{ fillWidth:1200, quality:90 }), generation);
        if (k===S.idx) stripSlots[k].box.classList.add("active"); else stripSlots[k].box.classList.remove("active");
        stripSlots[k].box.onclick = (function(ix){ return function(e){ e.preventDefault(); e.stopPropagation(); render(ix); }; })(k);
      }
      for (var hidden=n;hidden<stripSlots.length;hidden++){
        stripSlots[hidden].box.classList.remove('active'); stripSlots[hidden].box.onclick=null;
        if(stripSlots[hidden].img._vaObjectUrl){ forgetObjectUrl(stripSlots[hidden].img._vaObjectUrl); stripSlots[hidden].img._vaObjectUrl=null; }
        stripSlots[hidden].img.removeAttribute('src');
      }

      // فيديو/تريلر
      teaserOf(it).then(function(t){
        if (generation !== S.renderGeneration) return;
        var nextMediaKey=mediaKey(t);
        if(nextMediaKey===S.currentMediaKey) return;
        disposeMedia(); S.currentMediaKey=nextMediaKey;
        if (t.kind === "video"){
          var isHLS = /\.m3u8(\?|#|$)/i.test(t.url) || !!t.hls; // دعم إجبار hls.js للرابط القادم من yt-dlp
          // داخل JMP: لا نشغل HLS إطلاقًا
          if (IS_JMP && isHLS) { return; }
          var needHlsJs = isHLS; // FORCE hls.js for every HLS stream

          var playDirect = function(){
            S.mode = "video";
            loadLocalAudio();
            setHint('');
            video.src = t.url;
            video.style.display = "block";
            hideAudioSourceUi();
            video.addEventListener('loadedmetadata', function(){ refreshAudioSourceUi(); }, { once:true });
            // أظهر الفيديو فقط بعد بدء التشغيل لتحسين عرض تطبيق سطح المكتب
            video.addEventListener('playing', function onPlay(){ try{ video.removeEventListener('playing', onPlay); }catch(_){ } video.style.opacity='1'; }, { once:true });
            video.addEventListener('loadeddata', function onLd(){ try{ video.removeEventListener('loadeddata', onLd); }catch(_){ } if (video.style.opacity !== '1') video.style.opacity = '1'; }, { once:true });
            // داخل JMP: تشغيل متأخر لضمان تهيئة العنصر قبل play()
            var doPlay = function(){
              try { video.load && video.load(); } catch(_){ }
              S._playToken = (S._playToken || 0) + 1;
              playWithRetry(S._playToken);
            };
            if (IS_JMP) later(doPlay, 120); else doPlay();
            updateAudioIcon();
            later(refreshAudioSourceUi, 180);
          };

          if (!needHlsJs){
            playDirect();
          } else {
            // محاولة استخدام hls.js لتجاوز مشكلة الصوت فقط في mpv/JMP
            ensureHls().then(function(Hls){
              if (generation !== S.renderGeneration) return;
              if (!Hls || !Hls.isSupported()) {
                // fallback إلى المشغل المباشر لو hls.js غير مدعوم
                playDirect();
                return;
              }
              try {
                S.mode = 'video';
                loadLocalAudio();
                video.style.display = 'block';
                var hls = new Hls({ autoStartLoad: true, lowLatencyMode: true, enableWorker: true });
                // تمرير رؤوس مخصصة إن وُجدت
                if (t.headers && typeof t.headers === 'object'){
                  try {
                    var customHdrs = t.headers; // قيود المتصفح تمنع بعض الرؤوس (User-Agent ...)
                    hls.config.xhrSetup = function(xhr){
                      try { for (var hk in customHdrs){ if(Object.prototype.hasOwnProperty.call(customHdrs,hk)){ xhr.setRequestHeader(hk, customHdrs[hk]); } } } catch(_){ }
                    };
                  } catch(_){ }
                }
                // حفظ مرجع للتنظيف لاحقًا
                S._hlsInstance && S._hlsInstance.destroy && S._hlsInstance.destroy();
                S._hlsInstance = hls;
                hls.on(Hls.Events.MEDIA_ATTACHED, function(){ /* يمكن إضافة لوج */ });
                try {
                  hls.on(Hls.Events.MANIFEST_PARSED, function(){ later(refreshAudioSourceUi, 0); });
                  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(){ later(refreshAudioSourceUi, 0); });
                } catch(_){ }
                hls.on(Hls.Events.ERROR, function(ev,data){ if ((data || {}).fatal){ try { hls.destroy(); } catch(_){} playDirect(); } });
                hls.loadSource(t.url);
                hls.attachMedia(video);
                video.addEventListener('playing', function onPH(){ try{ video.removeEventListener('playing', onPH);}catch(_){ } video.style.opacity='1'; }, { once:true });
                var played = video.play();
                if (played && typeof played.then === 'function') played.then(function(){ setDimmed(true); }).catch(function(){});
                updateAudioIcon();
                later(refreshAudioSourceUi, 220);
              } catch(e){ /* فشل hls — تجاهل */ }
            }).catch(function(){
              // فشل تحميل hls.js => fallback إلى التشغيل المباشر
              playDirect();
            });
          }
        } else if (t.kind === "iframe"){
          // داخل JMP: لا نستخدم iframe (YouTube/Vimeo لا تعمل جيدًا داخل MPV)
          if (IS_JMP) { return; }
          S.mode="iframe"; S.iframeSource = t.source || null;
          // yt JS API متاح فقط عند وجود origin=http(s) في الرابط
          S.ytJsApi = (S.iframeSource === 'youtube') && (t.ytJsApi === true);
          iframe.src = t.url; iframe.style.display="block";
          hideAudioSourceUi();
          iframe.addEventListener("load", function(){ setDimmed(true); }, { once:true });
          requestAnimationFrame(function(){ iframe.style.opacity="1"; });
          if (S.iframeSource === "youtube" && S.ytJsApi){ ytSetDefaultVolume(); }
          updateAudioIcon();
        } else {
          // لا شيء: تبقى الخلفية فقط
          var msg = hintForReason(t.reason);
          if (msg) setHint(msg);
        }
      }).catch(function(){ /* تجاهل أخطاء التريلر */ });
    }

    // تفاعل الخلفية (نقرة/لمس لتفعيل الصوت/تشغيل)
    function bgInteract(e){
      try { e.preventDefault(); } catch(_){}
      if (S.mode === "video"){
        if (video.paused){ try{ video.play(); }catch(_){} setDimmed(true); }
        else { try{ video.pause(); }catch(_){} setDimmed(false); }
      } else if (S.mode === "iframe" && S.iframeSource === "youtube"){
        onUserGesture();
      }
    }
    bg.addEventListener("click", bgInteract, false);
    bg.addEventListener("touchend", bgInteract, { passive:false });

    function listRevision(list){ return (list||[]).map(function(item){ return item.Id+':'+MEDIA_CACHE.itemRevision(item); }).join('||'); }
    function setRefreshUi(active){
      refreshBtn.disabled=!!active; refreshBtn.classList.toggle('loading',!!active);
      refreshBtn.title=active?T('refreshing'):T('refresh'); refreshBtn.setAttribute('aria-label',refreshBtn.title);
    }
    function refresh(reason){
      if(S.destroyed) return Promise.resolve(false);
      if(S.refreshing) return S.refreshPromise;
      S.refreshing=true; setRefreshUi(true);
      var refreshGeneration=++S.refreshGeneration;
      var selected=current(), selectedId=selected&&selected.Id, selectedType=S.type;
      var beforeMovie=listRevision(S.data.Movie), beforeSeries=listRevision(S.data.Series);
      S.refreshPromise=Promise.all([getLatest("Movie"), getLatest("Series")]).then(function(arr){
        if(S.destroyed || refreshGeneration!==S.refreshGeneration) return false;
        var movies=arr[0]||[], series=arr[1]||[];
        S.data.Movie=movies; S.data.Series=series;
        if (!S.data.Movie.length && !S.data.Series.length) { try{ console.warn("[VA] " + T('noItems')); }catch(_){ } return; }
        if(!S.data[S.type].length) S.type=S.data.Movie.length?"Movie":"Series";
        var activeList=S.data[S.type], selectedIndex=-1;
        if(selectedId && S.type===selectedType){ for(var x=0;x<activeList.length;x++){ if(activeList[x].Id===selectedId){ selectedIndex=x; break; } } }
        S.idx=selectedIndex>=0?selectedIndex:Math.min(S.idx,Math.max(0,activeList.length-1));
        tabM.style.display = S.data.Movie.length ? '' : 'none';
        tabM.disabled = !S.data.Movie.length;
        tabS.style.display = S.data.Series.length ? '' : 'none';
        tabS.disabled = !S.data.Series.length;
        updateTabs();
        var changed=beforeMovie!==listRevision(movies)||beforeSeries!==listRevision(series);
        if(reason==='create'||reason==='manual'||changed) render(S.idx);
        // lazy prefetch logos/backdrops of rest
        later(function(){
          try {
            ['Movie','Series'].forEach(function(tp){
              (S.data[tp]||[]).slice(1).forEach(function(it){
                prefetchAuthenticatedImage(imagePath(it.Id,'Logo'),imageQuery(it,'Logo',{fillWidth:1200,quality:90}));
                prefetchAuthenticatedImage(imagePath(it.Id,'Backdrop'),imageQuery(it,'Backdrop',{fillWidth:3840,height:2160,quality:90}));
              });
            });
          } catch(_){ }
        }, 500); return changed;
      }).catch(function(e){ if(!S.destroyed) try{ console.error(e); }catch(_){} return false; });
      S.refreshPromise=S.refreshPromise.then(function(result){ if(refreshGeneration===S.refreshGeneration){ S.refreshing=false; setRefreshUi(false); } return result; },function(error){ if(refreshGeneration===S.refreshGeneration){ S.refreshing=false; setRefreshUi(false); } throw error; });
      return S.refreshPromise;
    }
    function manualRefresh(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      if(S.refreshing||S.destroyed) return;
      var item=current(); if(item){ S.manualEpochs[item.Id]=(S.manualEpochs[item.Id]||0)+1; trailerCache.invalidateItem(item.Id); }
      refresh('manual');
    }
    function onVisibility(){ if(!document.hidden && root.isConnected) refresh('visibility'); }
    refreshBtn.addEventListener('click',manualRefresh,false);
    document.addEventListener('visibilitychange',onVisibility,false);

    function attach(){
      if(!S.intervals.length){
        var refreshInterval=setInterval(function(){ if(!document.hidden&&root.isConnected) refresh('interval'); },MEDIA_REFRESH_INTERVAL_MS);
        S.intervals.push(refreshInterval);
      }
      return refresh('create');
    }
    function destroy(){
      S.destroyed=true; S.refreshGeneration++;
      S.renderGeneration++;
      S.timers.forEach(function(id){ try{ clearTimeout(id); }catch(_){} }); S.timers=[];
      S.intervals.forEach(function(id){ try{ clearInterval(id); }catch(_){} }); S.intervals=[];
      try { document.removeEventListener('visibilitychange',onVisibility,false); } catch(_){}
      try { refreshBtn.removeEventListener('click',manualRefresh,false); } catch(_){}
      try { if (io) io.disconnect(); } catch(_){ }
      trailerCache.clear();
      revokeObjectUrls();
      disposeMedia();
      try{ root.remove(); }catch(_){}
      try{ styleEl.remove(); }catch(_){}
      try { if (S._hlsInstance && S._hlsInstance.destroy) S._hlsInstance.destroy(); } catch(_){ }
    }

    // حساب الارتفاع عندما لا تدعم المنصة aspect-ratio
    var noAspectApplied = false;
    function refreshSize(){
      try {
        var supportsAspect = (window.CSS && CSS.supports && CSS.supports("aspect-ratio: 16/9"));
        var w = root.parentElement ? root.parentElement.clientWidth : root.clientWidth; if (!w) w = root.clientWidth || 1000;
        if (!supportsAspect){
          if (!noAspectApplied){ document.documentElement.classList.add("no-aspect"); noAspectApplied = true; }
          root.style.setProperty("--sh-width", w+"px");
        } else if (noAspectApplied){
          document.documentElement.classList.remove("no-aspect"); noAspectApplied = false;
        }
        // Scale factor (تصغير مرن) — تصميم أصلي 1910px
        var scale = Math.max(0.45, Math.min(1, w / 1910));
        root.style.setProperty('--va-scale', scale.toString());
        // خط أصغر قليلاً على الشاشات الصغيرة
        var fontScale = (scale < 0.7 ? (0.9 + (scale-0.45)*0.4) : 1); // بين ~0.9 و 1
        root.style.setProperty('--va-font-scale', fontScale.toString());
      } catch(_){ }
    }

    // Performance: only play if visible
    var io = null;
    try {
      if ('IntersectionObserver' in window){
        io = new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if (en.isIntersecting){
              if (S.mode==='video' && video.paused){ try{ video.play(); }catch(_){}}
            } else {
              if (S.mode==='video' && !video.paused){ try{ video.pause(); }catch(_){}}
            }
          });
        }, { threshold:[0,0.25,0.5,0.75,1] });
        io.observe(root);
      }
    } catch(_){ }

    // واجهة عامة
    return { root:root, attach:attach, destroy:destroy, refreshSize:refreshSize, refresh:refresh };
  }
})();
