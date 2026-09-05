(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoAutoplayLifecycle = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  function create(env, factory) {
    var generation = 0, component = null, timer = null, stopped = false, deadline = 0;
    var pending = null, observer = null, failures = new Map(), configKey = env.configKey || '';
    var runtime = { failures: failures, mounted: false, generation: 0 };
    function unmount(reason) {
      var old = component;
      component = null; runtime.mounted = false;
      if (old) { old.destroy(); env.log('unmount: ' + reason); }
    }
    function cancel() { if (timer !== null) env.clearTimeout(timer); timer = null; }
    function check(g) {
      if (stopped || g !== generation) return;
      cancel();
      if (!env.isHome()) { unmount('navigation'); return; }
      var client = env.client(), cache = env.cache(), host = env.host();
      if (client && cache && host) {
        if (!component) {
          component = factory(client, cache); runtime.mounted = true;
          env.mount(component, host); component.attach(); env.log('mount');
        } else env.mount(component, host);
        return;
      }
      if (env.now() >= deadline) {
        if (!client) env.log('Authenticated Jellyfin client unavailable');
        if (!cache) env.log('VideoAutoplayCache unavailable');
        if (!host) env.log('Home section unavailable');
        return;
      }
      timer = env.setTimeout(function () { check(g); }, 100);
    }
    function navigate() {
      if (stopped) return;
      generation++; runtime.generation = generation; deadline = env.now() + 10000;
      cancel(); pending = null; unmount('navigation'); check(generation);
      if (env.configuration) {
        var g = generation;
        env.configuration().then(function(config){
          if(stopped || g!==generation) return;
          var nextKey=JSON.stringify(config);
          if(nextKey!==configKey){runtime.configure(nextKey);env.applyConfiguration(config);unmount('configuration');check(g);}
        }).catch(function(){});
      }
    }
    function changed() { if (!stopped) check(generation); }
    runtime.refresh = function () {
      if (!component || pending) return pending;
      var g = generation;
      pending = Promise.resolve(component.refresh('visibility')).catch(function () {}).finally(function () {
        if (g === generation) pending = null;
      });
      return pending;
    };
    runtime.configure = function (key) { if (key !== configKey) { configKey = key; failures.clear(); } };
    runtime.retry = function () { deadline = env.now() + 10000; check(generation); };
    runtime.dispose = function () {
      if (stopped) return;
      stopped = true; generation++; cancel(); unmount('dispose');
      if (observer) observer.disconnect();
      env.off('hashchange', navigate); env.off('popstate', navigate); env.off('viewshow', changed);
    };
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
  return { create: create, direct: direct };
});
