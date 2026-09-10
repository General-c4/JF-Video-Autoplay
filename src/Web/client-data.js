(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoAutoplayClientData = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  var fields = 'PrimaryImage,Overview,ProductionYear,RemoteTrailers,DateCreated,DateModified,RunTimeTicks,Genres,Studios,ImageTags,BackdropImageTags,ParentBackdropImageTags,MediaSources';
  function create(client) {
    var inflight = Object.create(null);
    function options(type, limit) {
      return { IncludeItemTypes:type, Recursive:true, Limit:limit, SortBy:'DateCreated', SortOrder:'Descending', Fields:fields };
    }
    function latest(type, limit) {
      if (inflight[type]) return inflight[type];
      var request;
      try { request = client.getItems(client.getCurrentUserId(), options(type, limit)); }
      catch (error) { return Promise.reject(error); }
      inflight[type] = Promise.resolve(request).then(function (result) {
        var items = result && (result.Items || result) || [];
        try { items.sort(function (a,b) { return new Date(b.DateCreated || 0) - new Date(a.DateCreated || 0); }); } catch (_) { }
        return items.slice(0, limit);
      }).finally(function () { delete inflight[type]; });
      return inflight[type];
    }
    function load(limit) {
      return Promise.all(['Movie','Series'].map(function (type) {
        return latest(type, limit).then(function (items) { return {type:type,ok:true,items:items}; })
          .catch(function (error) { return {type:type,ok:false,items:[],error:error}; });
      })).then(function (results) {
        var output = {Movie:[],Series:[],failures:[]};
        results.forEach(function (result) { output[result.type]=result.items; if(!result.ok) output.failures.push(result.type); });
        return output;
      });
    }
    function requestHeaders() {
      var headers = {};
      try {
        if (typeof client.setRequestHeaders === 'function') {
          var returned = client.setRequestHeaders(headers);
          return returned && typeof returned === 'object' ? returned : headers;
        }
      } catch (_) { }
      return headers;
    }
    return {latest:latest,load:load,requestHeaders:requestHeaders};
  }
  return {create:create,fields:fields};
});
