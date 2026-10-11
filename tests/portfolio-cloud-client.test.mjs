import test from 'node:test';
import assert from 'node:assert/strict';
import {PortfolioController} from '../portfolio-controller.mjs';
function controller(){const received=[],logs=[];const value=Object.create(PortfolioController.prototype);Object.assign(value,{active:{snapshot:{id:'frozen'}},circuitRun:{started:performance.now(),progress(){},log:m=>logs.push(m),status(){}},receive:m=>received.push(m)});return {value,received,logs};}
test('cloud client finishes only with a provider result and logs the actual job',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);const requests=[];
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return Response.json(body.action==='submit'?{job:{id:'job-1',status:'submitted'},receipt:'signed'}:{job:{id:'job-1',status:'completed'},result:{snapshotId:'frozen',selected:{choices:[0,0,0,1]},execution:{jobId:'job-1'}}});};
 const {value,received,logs}=controller();await value.runCloud({id:'frozen'},[.1,.2,.3,.4]);
 assert.deepEqual(requests.map(r=>r.action),['submit','status']);assert.equal(requests[1].receipt,'signed');assert.equal(received.length,1);assert.equal(received[0].type,'result');assert.equal(received[0].result.execution.jobId,'job-1');assert(logs.some(m=>m.includes('job-1')));
});
test('cloud client never silently retries a failed submission or uses a local allocation',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({message:'Provider submission uncertain'}, {status:504});};
 const {value,received}=controller();await value.runCloud({id:'frozen'},null);assert.equal(calls,1);assert.equal(received[0].type,'error');assert.equal(received[0].message,'Provider submission uncertain');assert.equal(received[0].result,undefined);
});
test('changing the active snapshot during cloud submission does not finish an obsolete job',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);const {value,received}=controller();let calls=0;
 globalThis.fetch=async()=>{calls++;value.active=null;return Response.json({job:{id:'job-1',status:'submitted'},receipt:'signed'});};
 await value.runCloud({id:'frozen'},null);assert.equal(calls,1);assert.equal(received.length,0);
});
