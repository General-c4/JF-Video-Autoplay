'use strict';
const assert = require('node:assert/strict');
const lifecycle = require('../src/Web/runtime.js');
function scenario() {
  let home=true, ready=false, cache=false, now=0, mounts=0, destroyed=0;
  const callbacks=new Map(), timers=new Map(); let id=0;
  const runtime=lifecycle.create({
    now:()=>now,setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
    isHome:()=>home, client:()=>ready?{}:null,cache:()=>cache?{}:null,host:()=>({}),
    mount:()=>{},on:(name,fn)=>{assert.equal(callbacks.has(name),false);callbacks.set(name,fn);},off:name=>callbacks.delete(name),
    observe:fn=>({disconnect(){}}),log:()=>{}
  },()=>{mounts++;return{attach(){},destroy(){destroyed++;},refresh(){return Promise.resolve();}};});
  ready=true; cache=true; runtime.retry(); assert.equal(mounts,1);
  runtime.retry(); assert.equal(mounts,1);
  home=false;callbacks.get('hashchange')();assert.equal(destroyed,1);
  home=true;callbacks.get('hashchange')();assert.equal(mounts,2);
  ready=false;callbacks.get('hashchange')();now=11000;
  for(const fn of [...timers.values()])fn();assert.equal(runtime.mounted,false);
  ready=true;callbacks.get('hashchange')();assert.equal(runtime.mounted,true);
  runtime.configure('a');runtime.failures.set('yt-direct',123);runtime.configure('a');assert.equal(runtime.failures.size,1);
  runtime.configure('b');assert.equal(runtime.failures.size,0);
  runtime.dispose();runtime.dispose();assert.equal(callbacks.size,0);assert.equal(timers.size,0);
}
scenario();
async function directTests(){
  var requests=0,warnings=0,now=0,key='',failures=new Map();
  var runtime={failures,configure(value){if(value!==key){key=value;failures.clear();}}};
  const fallback={kind:'iframe',url:'https://www.youtube-nocookie.com/embed/test'};
  const options={runtime,configuration:'a',available:true,now:()=>now,user:async()=>({Policy:{IsAdministrator:true}}),
    request:async()=>{requests++;return{ok:false,error:'invalid_executable'};},fallback:()=>fallback,warn:()=>warnings++};
  assert.equal(await lifecycle.direct(options),fallback);assert.equal(warnings,1);
  assert.equal(await lifecycle.direct(options),fallback);assert.equal(requests,1);
  options.configuration='b';await lifecycle.direct(options);assert.equal(requests,2);
  now=16000;await lifecycle.direct(options);assert.equal(requests,3);
  options.configuration='c';options.user=async()=>({Policy:{IsAdministrator:false}});
  await lifecycle.direct(options);assert.equal(requests,3);
  options.user=async()=>({Policy:{IsAdministrator:true}});
  for(const error of ['400','401','403','404','timeout']){
    options.configuration=error;options.request=async()=>{throw new Error(error);};
    assert.equal(await lifecycle.direct(options),fallback);
  }
  scenario(); // Direct failure must not poison subsequent lifecycle creation/remount.
}
directTests().then(()=>console.log('runtime and direct fallback tests passed')).catch(error=>{console.error(error);process.exitCode=1;});
