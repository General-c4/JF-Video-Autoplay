'use strict';
const assert = require('node:assert/strict');
const dataApi = require('../src/Web/client-data.js');

async function run() {
  const calls=[];
  const client={
    getCurrentUserId:()=> 'user-1',
    getItems:(userId,options)=>{calls.push({userId,options});return Promise.resolve({Items:[{Id:options.IncludeItemTypes+'-1',DateCreated:'2026-01-01'}]});},
    setRequestHeaders:headers=>{headers.Authorization='official-session';}
  };
  const api=dataApi.create(client);
  const loaded=await api.load(5);
  assert.equal(loaded.Movie[0].Id,'Movie-1');
  assert.equal(loaded.Series[0].Id,'Series-1');
  assert.deepEqual(calls.map(call=>call.userId),['user-1','user-1']);
  assert.deepEqual(calls.map(call=>call.options.IncludeItemTypes),['Movie','Series']);
  for(const call of calls){
    assert.equal(call.options.Recursive,true);assert.equal(call.options.Limit,5);
    assert.equal(call.options.SortBy,'DateCreated');assert.equal(call.options.SortOrder,'Descending');
    for(const field of ['RemoteTrailers','DateModified','ImageTags','BackdropImageTags','ParentBackdropImageTags','MediaSources']) assert.ok(call.options.Fields.includes(field));
  }
  assert.deepEqual(api.requestHeaders(),{Authorization:'official-session'});

  let resolveMovie,concurrentCalls=0;
  const concurrent=dataApi.create({getCurrentUserId:()=> 'user-2',getItems:()=>{concurrentCalls++;return new Promise(resolve=>{resolveMovie=resolve;});}});
  const first=concurrent.latest('Movie',5),second=concurrent.latest('Movie',5);
  assert.equal(first,second);assert.equal(concurrentCalls,1);resolveMovie({Items:[]});await first;

  const partial=dataApi.create({
    getCurrentUserId:()=> 'user-3',
    getItems:(_,options)=>options.IncludeItemTypes==='Movie'?Promise.resolve({Items:[{Id:'movie'}]}):Promise.reject(new Error('401'))
  });
  const result=await partial.load(5);
  assert.deepEqual(result.Movie,[{Id:'movie'}]);assert.deepEqual(result.Series,[]);assert.deepEqual(result.failures,['Series']);
  assert.deepEqual(partial.requestHeaders(),{});
  assert.equal(JSON.stringify(calls).match(/api_key|accessToken|X-Emby-Token/i),null);
  console.log('client data tests passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
