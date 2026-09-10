(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoAutoplayAdminResponse = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  function clean(value) {
    var text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    return text && text !== '[object Response]' && text !== '[object Object]' ? text.slice(0, 300) : '';
  }
  function fromData(data, status, statusText) {
    data = data && typeof data === 'object' ? data : {};
    var code = clean(data.error) || clean(data.code);
    var message = clean(data.message);
    var fallback = status ? ('HTTP ' + status + (clean(statusText) ? ' ' + clean(statusText) : '')) : 'Request failed';
    return { code: code, message: message || code || fallback, status: status || 0 };
  }
  function describe(error) {
    if (!error) return Promise.resolve(fromData(null, 0, ''));
    var status = Number(error.status) || 0;
    var statusText = clean(error.statusText);
    var contentType = '';
    try { contentType = error.headers && typeof error.headers.get === 'function' ? String(error.headers.get('content-type') || '') : ''; } catch (_) { }
    if (/application\/json/i.test(contentType) && typeof error.json === 'function') {
      return Promise.resolve().then(function () { return error.json(); })
        .then(function (data) { return fromData(data, status, statusText); })
        .catch(function () { return fromData(null, status, statusText); });
    }
    if (typeof error === 'object' && (error.error || error.code || error.message)) {
      return Promise.resolve(fromData(error, status, statusText));
    }
    return Promise.resolve(fromData(null, status, statusText));
  }
  function ensureSuccess(response) {
    if (response && typeof response.ok === 'boolean' && !response.ok) return Promise.reject(response);
    if (response && typeof response.ok === 'boolean' && typeof response.json === 'function') {
      return response.json().catch(function () { return {}; });
    }
    return response;
  }
  return { describe: describe, ensureSuccess: ensureSuccess };
});
