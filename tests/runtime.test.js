'use strict';
const assert = require('node:assert/strict');
const lifecycle = require('../src/Web/runtime.js');
function nativeReceiverTests() {
  let timeoutId=0, cleared=0;
  const browser={
    Date:{now(){assert.equal(this,browser.Date);return 42;}},
    setTimeout(callback,delay){assert.equal(this,browser);assert.equal(typeof callback,'function');assert.equal(delay,100);return ++timeoutId;},
    clearTimeout(id){assert.equal(this,browser);cleared=id;}
  };
  const methods=lifecycle.browserMethods(browser);
  assert.equal(methods.now(),42);
  assert.equal(methods.setTimeout(()=>{},100),1);
  methods.clearTimeout(1);assert.equal(cleared,1);
}
function section(title, options={}) {
  const heading=title==null?null:{textContent:title};
  return {
    getClientRects:()=>options.hidden?[]:[{}],
    querySelector(selector){
      if(selector==='.sectionTitle, h2')return heading;
      return options.libraryTile?{}:null;
    },
    closest:()=>options.home===false?null:{}
  };
}
function librarySectionTests() {
  const titles=['محتواي','مكتبتي','المكتبة','My Media','My Library','Library'];
  for(const title of titles){const expected=section(title);assert.equal(lifecycle.findLibrarySection({querySelectorAll:()=>[expected]},titles),expected);}
  const wrong=section('Continue Watching'),structural=section('Something new',{libraryTile:true});
  assert.equal(lifecycle.findLibrarySection({querySelectorAll:()=>[wrong,structural]},titles),structural);
  assert.equal(lifecycle.findLibrarySection({querySelectorAll:()=>[wrong,section('Latest Media'),section('Favorites')]},titles),null);
  assert.equal(lifecycle.findLibrarySection({querySelectorAll:()=>[section('My Media',{hidden:true})]},titles),null);
}
function boundedFailureTests() {
  let observerCallback, scheduleLogs=0;
  const runtime=lifecycle.create({
    now:()=>0,setTimeout(){throw new TypeError('Illegal invocation');},clearTimeout(){},isHome:()=>true,
    client:()=>({}),cache:()=>({}),host:()=>null,mount(){},on(){},off(){},
    observe(fn){observerCallback=fn;return{disconnect(){}};},log(message){if(message==='Retry scheduling failed')scheduleLogs++;}
  },()=>{throw new Error('must not mount');});
  assert.doesNotThrow(()=>runtime.retry());
  for(let i=0;i<100;i++)assert.doesNotThrow(()=>observerCallback());
  assert.equal(scheduleLogs,1);
  runtime.dispose();
}
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
nativeReceiverTests();
librarySectionTests();
boundedFailureTests();
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
