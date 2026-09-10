(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoAutoplayLifecycle = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  function browserMethods(browser) {
    return {
      now: function () { return browser.Date.now(); },
      setTimeout: function (callback, delay) { return browser.setTimeout(callback, delay); },
      clearTimeout: function (timerId) { return browser.clearTimeout(timerId); }
    };
  }
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function findLibrarySection(doc, titles) {
    var allowed = (titles || []).map(normalizeText);
    var sections = doc && doc.querySelectorAll ? doc.querySelectorAll('.verticalSection') : [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (section.getClientRects && !section.getClientRects().length) continue;
      var heading = section.querySelector('.sectionTitle, h2');
      var title = normalizeText(heading && heading.textContent);
      if (title && allowed.indexOf(title) !== -1) return section;
    }
    for (var j = 0; j < sections.length; j++) {
      var candidate = sections[j];
      if (candidate.getClientRects && !candidate.getClientRects().length) continue;
      var libraryTile = candidate.querySelector(
        '[data-type="CollectionFolder"], [data-collectiontype], [data-library-id], .homeLibraryButton, .libraryCard');
      if (!libraryTile) continue;
      var home = candidate.closest && candidate.closest('#homePage, .homePage, .homeView, [data-page="home"], [data-view="home"], #reactRoot');
      if (home) return candidate;
    }
    return null;
  }
  function create(env, factory) {
    var generation = 0, component = null, timer = null, stopped = false, deadline = 0;
    var pending = null, observer = null, failures = new Map(), configKey = env.configKey || '';
    var runtime = { failures: failures, mounted: false, generation: 0 };
    var logged = Object.create(null);
    function logOnce(key, message) {
      if (logged[key]) return;
      logged[key] = true;
      try { env.log(message); } catch (_) { }
    }
    function unmount(reason) {
      var old = component;
      component = null; runtime.mounted = false;
      if (old) {
        try { old.destroy(); } catch (_) { logOnce('destroy', 'Component cleanup failed'); }
        try { env.log('unmount: ' + reason); } catch (_) { }
      }
    }
    function cancel() {
      if (timer !== null) {
        try { env.clearTimeout(timer); } catch (_) { logOnce('cancel', 'Timeout cancellation failed'); }
      }
      timer = null;
    }
    function check(g) {
      if (stopped || g !== generation) return;
      cancel();
      if (!env.isHome()) { unmount('navigation'); return; }
      var client = env.client(), cache = env.cache(), host = env.host();
      if (client && cache && host) {
        logOnce('home-found', 'Home library section found');
        if (!component) {
          var next = factory(client, cache);
          env.mount(next, host); next.attach();
          component = next; runtime.mounted = true; logOnce('hero-mounted', 'Hero mounted');
        } else env.mount(component, host);
        return;
      }
      if (!host) logOnce('waiting-home', 'Waiting for Jellyfin home section');
      if (env.now() >= deadline) {
        if (!client) logOnce('client-unavailable', 'Authenticated Jellyfin client unavailable');
        if (!cache) logOnce('cache-unavailable', 'VideoAutoplayCache unavailable');
        if (!host) logOnce('home-unavailable', 'Home section unavailable');
        return;
      }
      try {
        timer = env.setTimeout(function () { safeCheck(g); }, 100);
      } catch (_) {
        timer = null;
        logOnce('schedule', 'Retry scheduling failed');
      }
    }
    function safeCheck(g) {
      try { check(g); } catch (_) { logOnce('runtime-check', 'Lifecycle check failed'); }
    }
    function navigate() {
      if (stopped) return;
      generation++; runtime.generation = generation; deadline = env.now() + 10000;
      cancel(); pending = null; unmount('navigation'); safeCheck(generation);
      if (env.configuration) {
        var g = generation;
        env.configuration().then(function(config){
          if(stopped || g!==generation) return;
          var nextKey=JSON.stringify(config);
          if(nextKey!==configKey){runtime.configure(nextKey);env.applyConfiguration(config);unmount('configuration');safeCheck(g);}
        }).catch(function(){});
      }
    }
    function changed() { if (!stopped) safeCheck(generation); }
    runtime.refresh = function () {
      if (!component || pending) return pending;
      var g = generation;
      pending = Promise.resolve(component.refresh('visibility')).catch(function () {}).finally(function () {
        if (g === generation) pending = null;
      });
      return pending;
    };
    runtime.configure = function (key) { if (key !== configKey) { configKey = key; failures.clear(); } };
    runtime.retry = function () { deadline = env.now() + 10000; safeCheck(generation); };
    runtime.dispose = function () {
      if (stopped) return;
      stopped = true; generation++; cancel(); unmount('dispose');
      if (observer) observer.disconnect();
      env.off('hashchange', navigate); env.off('popstate', navigate); env.off('viewshow', changed);
    };
    logOnce('initialized', 'Runtime initialized');
    env.on('hashchange', navigate); env.on('popstate', navigate); env.on('viewshow', changed);
    observer = env.observe(changed);
    navigate();
    return runtime;
  }
  async function direct(options) {
    var key = 'yt-direct';
    options.runtime.configure(options.configuration);
    if (!options.available || (options.runtime.failures.get(key) || 0) > options.now()) return options.fallback();
    try {
      var user = await options.user();
      if (!user || !user.Policy || user.Policy.IsAdministrator !== true) return options.fallback();
      var result = await options.request();
      if (!result || !result.ok || !result.url) {
        if (result && result.error === 'invalid_executable') options.warn();
        throw new Error('direct_unavailable');
      }
      return result;
    } catch (_) {
      options.runtime.failures.set(key, options.now() + 15000);
      return options.fallback();
    }
  }
  return { create: create, direct: direct, browserMethods: browserMethods, findLibrarySection: findLibrarySection };
});
