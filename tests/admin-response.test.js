'use strict';
const assert = require('node:assert/strict');
const errors = require('../src/Web/admin-response.js');

async function run() {
  const jsonResponse = {
    ok:false,status:404,statusText:'Not Found',headers:{get:()=> 'application/json'},
    json:async()=>({error:'index_not_found',message:'index.html is not visible inside the container.'})
  };
  const json = await errors.describe(jsonResponse);
  assert.equal(json.code,'index_not_found');
  assert.equal(json.message,'index.html is not visible inside the container.');
  assert.equal(json.status,404);

  const nonJson = await errors.describe({ok:false,status:500,statusText:'Server Error',headers:{get:()=> 'text/html'}});
  assert.equal(nonJson.message,'HTTP 500 Server Error');
  assert.equal(String(nonJson.message).includes('[object Response]'),false);

  const empty = await errors.describe({ok:false,status:502,statusText:'',headers:{get:()=> 'application/json'},json:async()=>{throw new Error('empty');}});
  assert.equal(empty.message,'HTTP 502');
  await assert.rejects(errors.ensureSuccess(jsonResponse), value => value === jsonResponse);
  assert.deepEqual(await errors.ensureSuccess({ok:true,json:async()=>({ok:true})}),{ok:true});
  console.log('admin response tests passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
