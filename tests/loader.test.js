'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/Web/loader.js'),'utf8');
async function run(){
 const scripts=[],inserted=[];
 function script(src){const listeners={};return{src,dataset:{},addEventListener(n,f){listeners[n]=f;},removeEventListener(n){delete listeners[n];},remove(){const i=scripts.indexOf(this);if(i>=0)scripts.splice(i,1);},loaded(){listeners.load?.();}};}
 scripts.push(script('https://example.test/VideoAutoplay/video-autoplay.js'));
 const document={scripts,createElement:()=>script(''),head:{appendChild(s){scripts.push(s);inserted.push(s.src);queueMicrotask(()=>s.loaded());}}};
 const window={__VA_LOADER__:1};const context=vm.createContext({window,document,location:{pathname:'/web/index.html',href:'https://example.test/web/index.html'},URL,console,setTimeout,clearTimeout});
 vm.runInContext(source,context);vm.runInContext(source,context);
 await window.VideoAutoplayLoader.promise;
 assert.equal(inserted.length,4);assert.equal(scripts.length,4);
 assert.ok(inserted.every(s=>s.endsWith('?v=1.1.2-rc1')));
 assert.deepEqual(inserted.map(s=>new URL(s).pathname),['/VideoAutoplay/config.js','/VideoAutoplay/media-cache.js','/VideoAutoplay/runtime.js','/VideoAutoplay/video-autoplay.js']);
 vm.runInContext(source,context);assert.equal(inserted.length,4);
 const frontend=fs.readFileSync(path.join(__dirname,'../src/Web/video-autoplay.js'),'utf8');
 let retries=0;window.VideoAutoplayRuntime={retry(){retries++;}};
 vm.runInContext(frontend,context);vm.runInContext(frontend,context);
 assert.equal(retries,2);assert.equal(inserted.length,4);
 console.log('duplicate loader/frontend tests passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
