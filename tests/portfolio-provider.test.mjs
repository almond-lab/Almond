import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioService,sampleIonQProbabilities} from '../server/portfolio-service.mjs';
import {makeSnapshot,stateToChoices,simulateQaoa,buildObjective,stateBitstring} from '../portfolio-model.mjs';
const env={IONQ_API_KEY:'test-key',ALMOND_EXECUTION_TOKEN:'x'.repeat(40),IONQ_BACKEND:'qpu.forte-1',ALMOND_ALLOW_QPU:'true'};
const id='0197379a-c3b8-7548-9da4-bbb7067311c1',artifactId='0197379a-c3b8-7548-9da4-bbb7067311c2';
const snapshot=makeSnapshot({id:'provider-test',version:1,createdAt:1000,localSeed:42,convictions:[.8,-.7,.3,.6],prices:[70000,6000,80,3000],equity:10000,covariance:[0.0016,0.000144,0.000625,0.000225].map((v,i)=>[0,0,0,0].map((_,j)=>i===j?v:0)),experiment:{forceRebalance:true,previousChoices:[0,0,0,0]}});
const req=body=>new Request('https://test.example/api/portfolio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const artifact=bits=>({probabilities:{registers:{output_all:{[bits]:1}}}});
test('IonQ v2 q0-left bit order maps BTC long and Gold short to the correct model states',()=>{
  const btc=sampleIonQProbabilities(artifact('10000000'),1024,1);assert.equal(btc.counts[1],1024);assert.deepEqual(stateToChoices(1),[1,0,0,0]);
  const gold=sampleIonQProbabilities(artifact('00000001'),1024,1);assert.equal(gold.counts[128],1024);assert.deepEqual(stateToChoices(128),[0,0,0,-1]);
  assert.throws(()=>sampleIonQProbabilities(artifact('1000000'),1024,1));assert.throws(()=>sampleIonQProbabilities({probabilities:{registers:{output_all:{'10000000':.4}}}},1024,1));
});
test('portfolio submits exactly one forced simulator job and allocates only draws from the provider distribution',async()=>{
 let submissions=0,submitted;
 const service=createPortfolioService({env,now:()=>1000,fetcher:async(url,options)=>{
   if(options.method==='POST'){submissions++;submitted=JSON.parse(options.body);return Response.json({id,status:'submitted'});}
   if(url.endsWith('/'+id))return Response.json({id,backend:'simulator',status:'completed',results:{'ionq.result.probabilities.json.v2':{id:artifactId}}});
   return Response.json(artifact('00000010')); // Gold long, model state 64
 }});
 const first=await service(req({action:'submit',snapshot}));assert.equal(first.status,202);const created=await first.json();
 await service(req({action:'submit',snapshot}));assert.equal(submissions,1);assert.equal(submitted.backend,'simulator');assert.equal(submitted.input.qubits,8);
 const res=await service(req({action:'status',snapshot,receipt:created.receipt}));assert.equal(res.status,200);const result=(await res.json()).result;
 assert.deepEqual(result.selected.choices,[0,0,0,1]);assert.equal(result.metrics.shots,1024);assert.equal(result.distribution.length,1);assert.equal(result.execution.jobId,id);
 const changed=await service(req({action:'status',snapshot:{...snapshot,convictions:[0,0,0,0]},receipt:created.receipt}));assert.equal(changed.status,409);
 const tampered=await service(req({action:'status',snapshot,receipt:created.receipt+'x'}));assert.equal(tampered.status,403);
});
test('provider errors and invalid/all-flat distributions never substitute classical or local samples',async()=>{
 for(const mode of ['denied','flat','invalid']){
 const service=createPortfolioService({env,now:()=>1000,fetcher:async(url,options)=>{
   if(mode==='denied')return Response.json({}, {status:401});
   if(options.method==='POST')return Response.json({id,status:'submitted'});
   if(url.endsWith('/'+id))return Response.json({id,backend:'simulator',status:'completed',results:{'ionq.result.probabilities.json.v2':{id:artifactId}}});
   return Response.json(mode==='flat'?artifact('00000000'):artifact('bad'));
 }});
 const submitted=await service(req({action:'submit',snapshot}));
 if(mode==='denied'){assert.equal(submitted.status,502);continue;}
 const {receipt}=await submitted.json();const res=await service(req({action:'status',snapshot,receipt}));const value=await res.json();
 if(mode==='flat'){assert.equal(res.status,200);assert.equal(value.result.selected,null);assert(value.result.exact);}else{assert.equal(res.status,400);assert.equal(value.result,undefined);}
 }
});
test('seeded draws are reproducible and follow a provider distribution rather than local simulation',()=>{
 const p=simulateQaoa(buildObjective(snapshot),[.1,.2,.3,.4]).probabilities;
 const data={probabilities:{registers:{output_all:Object.fromEntries(p.map((value,state)=>[stateBitstring(state),value]))}}};
 const a=sampleIonQProbabilities(data,1024,42),b=sampleIonQProbabilities(data,1024,42);assert.deepEqual(a.counts,b.counts);assert.equal(a.counts.reduce((sum,n)=>sum+n,0),1024);for(let i=0;i<256;i++)assert(Math.abs(a.probabilities[i]-p[i])<1e-12);
});

test('small provider truncation is disclosed and normalized without inventing missing support',()=>{const v=sampleIonQProbabilities({probabilities:{registers:{output_all:{'10000000':.9969}}}},1024,1);assert.equal(v.returnedProbabilityMass,.9969);assert.equal(v.probabilities[1],1);assert.equal(v.counts[1],1024);assert.equal(v.counts[0],0);});

test('public portfolio route rejects other origins and exposes only setup state',async()=>{
 let calls=0;const service=createPortfolioService({env,fetcher:async()=>{calls++;throw Error('unexpected');}});
 const status=await(await service(new Request('https://test.example/api/portfolio'))).json();assert.equal(status.backend,'simulator');assert.equal(status.ready,true);assert(!JSON.stringify(status).includes(env.IONQ_API_KEY));
 const blocked=await service(new Request('https://test.example/api/portfolio',{method:'POST',headers:{Origin:'https://another.example','Content-Type':'application/json'},body:JSON.stringify({action:'submit',snapshot})}));assert.equal(blocked.status,403);assert.equal(calls,0);
});
