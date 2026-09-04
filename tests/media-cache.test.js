'use strict';
const assert = require('assert');
const cache = require('../src/Web/media-cache.js');

const base = {
  Id: 'item-1', DateModified: '2026-09-04T10:00:00Z',
  ImageTags: { Primary:'primary-a', Logo:'logo-a' },
  BackdropImageTags: ['backdrop-a'], ParentBackdropImageTags: ['parent-a'],
  RemoteTrailers: [{ Url:'https://youtu.be/first' }],
  MediaSources: [{ Id:'source-a', Path:'/media/a.mkv', Container:'mkv', Protocol:'File' }]
};
const changed = Object.assign({}, base, { ImageTags:Object.assign({},base.ImageTags,{Logo:'logo-b'}) });
assert.deepStrictEqual(cache.imageQuery(base,'Logo',{quality:90}),cache.imageQuery(base,'Logo',{quality:90}), 'unchanged image URL query');
assert.notDeepStrictEqual(cache.imageQuery(base,'Logo',{}),cache.imageQuery(changed,'Logo',{}), 'changed logo tag');
assert.notStrictEqual(cache.imageRevision(base,'Backdrop'),cache.imageRevision(Object.assign({},base,{BackdropImageTags:['backdrop-b']}),'Backdrop'), 'changed backdrop tag');
assert.notStrictEqual(cache.imageRevision({DateModified:'a'},'Logo'),cache.imageRevision({DateModified:'b'},'Logo'), 'fallback revision');
assert.ok(!JSON.stringify(cache.imageQuery(base,'Logo',{})).match(/token|api_key|access/i), 'no access token in image query');

let now=1000, calls=0;
const trailers=cache.createTrailerCache({now:()=>now,positiveTtl:100,negativeTtl:10});
const key=cache.trailerKey(base,{enableYtDirect:true,ytPreferMp4:true},false);
trailers.put(key,{kind:'video',url:'https://video/one.mp4'}); calls++;
assert.strictEqual(trailers.get(key).url,'https://video/one.mp4','valid trailer reused');
assert.strictEqual(calls,1);
const trailerChanged=Object.assign({},base,{RemoteTrailers:[{Url:'https://youtu.be/second'}]});
assert.strictEqual(trailers.get(cache.trailerKey(trailerChanged,{enableYtDirect:true,ytPreferMp4:true},false)),null,'changed trailer invalidates key');
const revisionChanged=Object.assign({},base,{DateModified:'2026-09-04T11:00:00Z'});
assert.strictEqual(trailers.get(cache.trailerKey(revisionChanged,{enableYtDirect:true,ytPreferMp4:true},false)),null,'changed revision invalidates key');
trailers.put('negative',{kind:'none'}); now+=11;
assert.strictEqual(trailers.get('negative'),null,'negative cache expires');
trailers.invalidateItem(base.Id);
assert.strictEqual(trailers.get(key),null,'manual item invalidation');
console.log('media-cache tests passed');
