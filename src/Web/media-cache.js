(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoAutoplayCache = api;
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  function text(value){ return value === undefined || value === null ? '' : String(value); }
  function first(values){ return Array.isArray(values) && values.length ? text(values[0]) : ''; }
  function trailerUrl(item){
    return text(item && item.RemoteTrailers && item.RemoteTrailers[0] && item.RemoteTrailers[0].Url);
  }
  function mediaSourceIdentity(item){
    var sources = item && Array.isArray(item.MediaSources) ? item.MediaSources : [];
    return sources.map(function(source){
      return [text(source.Id), text(source.Path), text(source.Container), text(source.Protocol)].join(':');
    }).join('|');
  }
  function imageRevision(item, type){
    var tags = item && item.ImageTags || {};
    var value = text(tags[type]);
    if (!value && type === 'Backdrop') value = first(item && item.BackdropImageTags);
    if (!value && type === 'Backdrop') value = first(item && item.ParentBackdropImageTags);
    return value || text(item && (item.DateModified || item.DateCreated));
  }
  function itemRevision(item){
    return [
      text(item && item.DateModified),
      imageRevision(item, 'Primary'),
      imageRevision(item, 'Logo'),
      imageRevision(item, 'Backdrop'),
      trailerUrl(item),
      mediaSourceIdentity(item)
    ].join('|');
  }
  function imageQuery(item, type, dimensions, manualEpoch){
    var query = {};
    Object.keys(dimensions || {}).forEach(function(key){ query[key] = dimensions[key]; });
    var revision = imageRevision(item, type);
    if (revision) query.tag = revision;
    if (manualEpoch) query.vaRefresh = String(manualEpoch);
    return query;
  }
  function trailerKey(item, cfg, isJmp){
    return [
      text(item && item.Id), itemRevision(item), trailerUrl(item),
      cfg && cfg.preferRemoteTrailers === false ? 'remote:0' : 'remote:1',
      cfg && cfg.enableYtDirect ? 'ytdlp:1' : 'ytdlp:0',
      cfg && cfg.ytPreferMp4 ? 'mp4:1' : 'mp4:0',
      cfg && cfg.ytForceFormat18 ? 'f18:1' : 'f18:0',
      isJmp ? 'jmp:1' : 'jmp:0'
    ].join('||');
  }
  function sameItem(a, b){ return !!a && !!b && text(a.Id) === text(b.Id) && itemRevision(a) === itemRevision(b); }
  function createTrailerCache(options){
    options = options || {};
    var now = options.now || Date.now;
    var positiveTtl = options.positiveTtl || 300000;
    var negativeTtl = options.negativeTtl || 15000;
    var entries = Object.create(null);
    function get(key){
      var entry = entries[key];
      if (!entry || entry.expiresAt <= now()) { delete entries[key]; return null; }
      return entry.value;
    }
    function put(key, value){
      var negative = !value || value.kind === 'none';
      entries[key] = { value:value, expiresAt:now() + (negative ? negativeTtl : positiveTtl) };
      return value;
    }
    function invalidateItem(itemId){
      var prefix = text(itemId) + '||';
      Object.keys(entries).forEach(function(key){ if (key.indexOf(prefix) === 0) delete entries[key]; });
    }
    function clear(){ entries = Object.create(null); }
    return { get:get, put:put, invalidateItem:invalidateItem, clear:clear };
  }
  return {
    trailerUrl:trailerUrl,
    imageRevision:imageRevision,
    itemRevision:itemRevision,
    imageQuery:imageQuery,
    trailerKey:trailerKey,
    sameItem:sameItem,
    createTrailerCache:createTrailerCache
  };
});
