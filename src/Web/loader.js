(() => {
  const version = '1.1.2-rc1';
  const previous = window.VideoAutoplayLoader;
  if (previous && previous.version === version) {
    console.debug('[VA] Duplicate loader suppressed');
    if (window.VideoAutoplayRuntime) window.VideoAutoplayRuntime.retry();
    return;
  }
  if (previous) previous.cancelled = true;
  if (window.VideoAutoplayRuntime) window.VideoAutoplayRuntime.dispose();
  if (window.__JF_HERO && typeof window.__JF_HERO.dispose === 'function') window.__JF_HERO.dispose();
  delete window.VideoAutoplayRuntime;
  const state = window.VideoAutoplayLoader = { version, cancelled:false };
  window.__VA_LOADER__ = 1;
  const base = (location.pathname.split('/web/')[0] || '').replace(/\/+$/,'');
  const loadScript = p => new Promise((resolve,reject) => {
    if (state.cancelled) return reject(new Error('superseded'));
    const expected = new URL(base+p+'?v='+version,location.href).href;
    const matches = Array.from(document.scripts).filter(s => {
      try { return new URL(s.src,location.href).pathname === base+p; } catch (_) { return false; }
    });
    let script = matches.find(s => s.src === expected);
    matches.filter(s=>s!==script).forEach(s=>s.remove());
    if (script && script.dataset.vaLoaded === 'true') { resolve(); return; }
    const created = !script;
    if (!script) script=document.createElement('script');
    script.src=expected; script.defer=true;
    const timeout=setTimeout(()=>finish(new Error('dependency_timeout')),10000);
    function finish(error) {
      clearTimeout(timeout);
      script.removeEventListener('load',loaded); script.removeEventListener('error',failed);
      if (error) {script.remove();reject(error);} else {script.dataset.vaLoaded='true';resolve();}
    }
    function loaded(){finish();}
    function failed(){finish(new Error('dependency_failed'));}
    script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});
    if(created)document.head.appendChild(script);
  });
  state.promise=loadScript('/VideoAutoplay/config.js')
    .then(()=>loadScript('/VideoAutoplay/media-cache.js'))
    .then(()=>loadScript('/VideoAutoplay/runtime.js'))
    .then(()=>loadScript('/VideoAutoplay/video-autoplay.js'))
    .catch(()=>{
      if(window.VideoAutoplayLoader===state){delete window.VideoAutoplayLoader;window.__VA_LOADER__=0;}
      console.error('[VA] Failed to load dependency; Loader stopped');
    });
})();
