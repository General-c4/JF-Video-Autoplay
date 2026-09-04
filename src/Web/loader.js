(() => {
  if (window.__VA_LOADER__) return;
  window.__VA_LOADER__ = 1;

  const base = (location.pathname.split('/web/')[0] || '').replace(/\/+$/,'');
  const url = p => (base ? base + p : p);
  const loaderVersion = (() => {
    try { return new URL(document.currentScript.src, location.href).searchParams.get('v') || '1.1.1'; }
    catch (_) { return '1.1.1'; }
  })();
  const versioned = p => url(p) + '?v=' + encodeURIComponent(loaderVersion);
  const loadScript = p => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = versioned(p);
    script.defer = true;
    script.onload = () => resolve(script.src);
    script.onerror = event => {
      const error = new Error('[VA] Failed to load dependency: ' + script.src);
      try { console.error(error.message, event); } catch (_) {}
      reject(error);
    };
    document.head.appendChild(script);
  });

  loadScript('/VideoAutoplay/config.js')
    .then(() => loadScript('/VideoAutoplay/media-cache.js'))
    .then(() => loadScript('/VideoAutoplay/video-autoplay.js'))
    .catch(error => {
      window.__VA_LOADER__ = 0;
      try { console.error('[VA] Loader stopped:', error && error.message ? error.message : error); } catch (_) {}
    });
})();
