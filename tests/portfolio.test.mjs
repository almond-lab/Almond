import test from 'node:test';
import assert from 'node:assert/strict';
import { COINS, DEFAULTS, conviction, makeSnapshot, stateToChoices, choicesToState,
  stateBitstring, evaluateChoices, financeMetrics, buildObjective, solveExact,
  simulateQaoa, optimizeLocal, selectSampled, buildIonQCircuit } from '../portfolio-model.mjs';
const close = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b)<=tolerance, `${a} != ${b}`);
function fixture(overrides={}) {
  const b=[[.015,.004,0],[.006,.009,0],[.003,.002,.018],[-.002,.005,.003]], diagonal=[.000625,.000025,.000144,.000049];
  const covariance=b.map((row,i)=>b.map((other,j)=>row.reduce((sum,x,k)=>sum+x*other[k],0)+(i===j?diagonal[i]:0)));
  return makeSnapshot({id:'experiment-1',version:1,createdAt:1000,convictions:[.8,-.7,.3,.6],prices:[70000,6000,80,3000],
    covariance,holdings:[-.2*10000/70000,0,.2*10000/80,0],equity:10000,fundingRates:[.00001,.00002,-.00001,0],...overrides});
}
test('conviction is decayed, bounded and capped by thesis, not a click multiplier',()=>{
  const now=100000000;
  const duplicateThesis=Array.from({length:10},(_,id)=>({id:String(id),coin:'BTC',direction:1,thesis:'Bitcoin adoption',at:now}));
  const scores=conviction(duplicateThesis,now);
  assert.equal(scores.length,4);assert.deepEqual(scores.map(x=>x.coin),COINS);
  close(scores[0].evidence,1);close(scores[0].score,Math.tanh(.5));
  const once=conviction([duplicateThesis[0],duplicateThesis[0]],now);close(once[0].evidence,1);
  const cancel=conviction([duplicateThesis[0],{...duplicateThesis[1],direction:-1}],now);close(cancel[0].score,0);
  const independent=duplicateThesis.slice(0,4).map((x,i)=>({...x,thesis:`distinct-${i}`}));
  const initial=conviction(independent,now)[0],later=conviction(independent,now+24*3600000)[0];
  close(initial.score,Math.tanh(2));close(later.score,Math.tanh(1));assert.ok(initial.score<1);
  assert.equal(DEFAULTS.slot,.2);assert.equal(DEFAULTS.grossLimit,.8);
});
test('snapshots clone and deep freeze immutable inputs with four-array validation and PSD check',()=>{
  const original={...fixture(),prices:[70000,6000,80,3000],settings:{...DEFAULTS},meta:{nested:[1]}};
  const frozen=makeSnapshot(original);original.prices[0]=1;original.meta.nested[0]=2;original.settings.slot=.1;
  assert.equal(frozen.prices[0],70000);assert.equal(frozen.meta.nested[0],1);assert.equal(frozen.settings.slot,.2);
  assert.ok(Object.isFrozen(frozen));assert.ok(Object.isFrozen(frozen.covariance[0]));
  assert.throws(()=>{frozen.holdings[0]=10},TypeError);
  assert.throws(()=>fixture({prices:[1,2,3]}),/four/);
  assert.throws(()=>fixture({prices:[0,1,2,3]}),/positive/);
  assert.throws(()=>fixture({settings:{slot:.3}}),/cannot exceed/);
  assert.throws(()=>fixture({covariance:[[1,2,0,0],[2,1,0,0],[0,0,1,0],[0,0,0,1]]}),/semidefinite/);
  const rankOne=Array.from({length:4},()=>[1,1,1,1]);assert.ok(fixture({covariance:rankOne}));
  assert.throws(()=>buildObjective(fixture({covariance:Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>i===j?1e307:0)),settings:{horizonHours:1e200}})),/finite numeric/);
  assert.deepEqual(fixture({convictions:[{score:3},{score:-3},.2,0]}).convictions,[1,-1,.2,0]);
});
test('encoding uses long then short per asset; 11 is invalid, never flat',()=>{
  assert.deepEqual(stateToChoices(1),[1,0,0,0]);assert.deepEqual(stateToChoices(2),[-1,0,0,0]);
  assert.equal(stateToChoices(3),null);assert.equal(stateToChoices(255),null);assert.throws(()=>stateBitstring(256),/integer/);
  assert.equal(stateBitstring(1),'10000000');assert.equal(stateBitstring(128),'00000001');
  let feasible=0;for(let state=0;state<256;state++){const choices=stateToChoices(state);if(choices){feasible++;assert.equal(choicesToState(choices),state)}}assert.equal(feasible,81);
});
function independentFinance(snapshot,choices){
  const s=snapshot.settings,w=choices.map(x=>x*s.slot),old=snapshot.holdings.map((q,i)=>q*snapshot.prices[i]/snapshot.equity);
  let variance=0;for(let i=0;i<4;i++)for(let j=0;j<4;j++)variance+=w[i]*snapshot.covariance[i][j]*w[j];
  variance*=s.horizonHours/24;
  const mismatch=choices.reduce((sum,x,i)=>sum+(x-snapshot.convictions[i])**2,0)/4;
  const turnover=w.reduce((sum,x,i)=>{const r=snapshot.executionRates[i];return sum+Math.abs(x-old[i])*(r.feeRate+r.spreadBps/20000+r.slippageBps/10000)},0);
  const funding=w.reduce((sum,x,i)=>sum+x*snapshot.fundingRates[i]*s.horizonHours,0);
  return s.beliefWeight*mismatch+s.riskWeight*variance/s.riskNormalization+s.turnoverWeight*turnover+s.fundingWeight*funding;
}
test('QUBO is identical to independently computed joint finance objective for all 81 portfolios',()=>{
  for(const snapshot of [fixture(),fixture({convictions:[-.1,.99,-.8,0],settings:{horizonHours:36,riskWeight:2,turnoverWeight:7},executionRates:[.001,.002,.0005,.0004]})]){
    const objective=buildObjective(snapshot);assert.equal(objective.linear.length,8);assert.equal(objective.pairs.length,28);
    let maxFeasible=-Infinity,minInvalid=Infinity;
    for(let state=0;state<256;state++){
      const choices=stateToChoices(state),cost=objective.evaluateState(state),breakdown=objective.costBreakdown(state);
      close(cost,breakdown.total);
      if(choices){const expected=independentFinance(snapshot,choices);close(cost,expected);close(cost,evaluateChoices(snapshot,choices).cost);maxFeasible=Math.max(maxFeasible,cost)}
      else{assert.ok(breakdown.invalidEncoding>0);minInvalid=Math.min(minInvalid,cost)}
    }
    assert.ok(minInvalid>maxFeasible,'every invalid encoding must be worse than every feasible portfolio');
    const reference=solveExact(snapshot);close(reference.cost,independentFinance(snapshot,reference.choices));
    for(let state=0;state<256;state++){const choices=stateToChoices(state);if(choices)assert.ok(reference.cost<=independentFinance(snapshot,choices)+1e-10)}
  }
});
test('a belief-only update changes its two linear fields, never pair couplings or encoding penalty',()=>{
  const first=fixture(),second=fixture({convictions:[-.95,...first.convictions.slice(1)]});
  const a=buildObjective(first),b=buildObjective(second);
  assert.deepEqual(a.pairs,b.pairs);assert.equal(a.invalidPenalty,b.invalidPenalty);
  assert.deepEqual(a.linear.slice(2),b.linear.slice(2));assert.notEqual(a.linear[0],b.linear[0]);assert.notEqual(a.linear[1],b.linear[1]);
});
test('flip costs both closing and opening, with signed funding and separate dollar metrics',()=>{
  const snapshot=fixture(),same=evaluateChoices(snapshot,[-1,0,1,0]),flip=evaluateChoices(snapshot,[1,0,1,0]);
  close(same.breakdown.turnoverDollars,0);
  const rate=DEFAULTS.feeRate+DEFAULTS.spreadBps/20000+DEFAULTS.slippageBps/10000;
  close(flip.breakdown.turnoverDollars,.4*snapshot.equity*rate);
  const metrics=financeMetrics(snapshot,[1,0,1,0]);close(metrics.gross,.4);close(metrics.turnoverDollars,flip.breakdown.turnoverDollars);assert.ok(metrics.portfolioVolatility>=0);
  close(flip.breakdown.fundingDollars,(.2*.00001+.2*-.00001)*24*snapshot.equity);
});
test('actual state-vector evolution preserves normalization and depends on cost interactions',()=>{
  const objective=buildObjective(fixture()),angles=[.31,.24,.42,-.19];
  const result=simulateQaoa(objective,angles);close(result.normalization,1,1e-12);
  assert.ok(result.probabilities.every(p=>p>=0));assert.equal(result.real.length,256);
  const trivial=simulateQaoa(Array(256).fill(0),angles);for(const p of trivial.probabilities)close(p,1/256,1e-12);
  assert.ok(result.probabilities.some((p,i)=>Math.abs(p-trivial.probabilities[i])>1e-5));
});
// Independent simulator for the JSON gate sequence, checking radians, signs,
// CNOT parity and relative phases rather than mirroring QUBO formulas.
function runCircuit(circuit){
  const r=new Float64Array(256),im=new Float64Array(256);r[0]=1;
  for(const gate of circuit.circuit){
    const bit=1<<gate.target;
    if(gate.gate==='cnot'){for(let state=0;state<256;state++)if((state&(1<<gate.control))&&!(state&bit)){const other=state|bit;[r[state],r[other]]=[r[other],r[state]];[im[state],im[other]]=[im[other],im[state]]}continue}
    if(gate.gate==='rz'){for(let state=0;state<256;state++){const phase=(state&bit?1:-1)*gate.rotation/2,c=Math.cos(phase),s=Math.sin(phase),rr=r[state],ii=im[state];r[state]=rr*c-ii*s;im[state]=rr*s+ii*c}continue}
    for(let state=0;state<256;state++)if(!(state&bit)){
      const other=state|bit,a=r[state],b=r[other],ai=im[state],bi=im[other];
      if(gate.gate==='h'){r[state]=(a+b)/Math.SQRT2;im[state]=(ai+bi)/Math.SQRT2;r[other]=(a-b)/Math.SQRT2;im[other]=(ai-bi)/Math.SQRT2}
      else if(gate.gate==='rx'){const c=Math.cos(gate.rotation/2),s=Math.sin(gate.rotation/2);r[state]=c*a+s*bi;im[state]=c*ai-s*b;r[other]=c*b+s*ai;im[other]=c*bi-s*a}
      else throw new Error(`Unexpected gate ${gate.gate}`);
    }
  }
  return {real:r,imaginary:im};
}
test('IonQ QIS circuit reproduces local amplitudes up to global phase with rotations in radians',()=>{
  const snapshot=fixture(),angles=[.29,.18,-.31,.23],json=buildIonQCircuit(snapshot,angles);
  assert.equal(json.qubits,8);assert.equal(json.gateset,'qis');assert.ok(json.circuit.length<=220);
  const actual=runCircuit(json),expected=simulateQaoa(buildObjective(snapshot),angles);
  const pivot=expected.probabilities.findIndex(p=>p>.001),ar=actual.real[pivot],ai=actual.imaginary[pivot],er=expected.real[pivot],ei=expected.imaginary[pivot],d=er*er+ei*ei;
  const gr=(ar*er+ai*ei)/d,gi=(ai*er-ar*ei)/d;close(gr*gr+gi*gi,1,1e-10);
  for(let state=0;state<256;state++){close(actual.real[state],expected.real[state]*gr-expected.imaginary[state]*gi,1e-10);close(actual.imaginary[state],expected.real[state]*gi+expected.imaginary[state]*gr,1e-10)}
});
test('fixed-budget tuning, genuine seeded shots, sampled selection and independent truth metrics',()=>{
  const snapshot=fixture(),result=optimizeLocal(snapshot,null,'stable-seed'),again=optimizeLocal(snapshot,null,'stable-seed');
  assert.equal(result.snapshotId,snapshot.id);assert.equal(result.metrics.evaluations,48);assert.equal(result.metrics.shots,1024);
  assert.equal(result.distribution.reduce((sum,x)=>sum+x.count,0),1024);assert.deepEqual(result.distribution,again.distribution);
  assert.ok(result.metrics.expectedCost<=result.metrics.initialExpectedCost+1e-12);close(result.metrics.normalization,1,1e-12);
  assert.ok(result.selected);assert.ok(result.distribution.find(x=>x.state===result.selected.state&&x.feasible&&x.count>0));
  assert.ok(stateToChoices(result.selected.state));assert.ok(result.selected.breakdown.gross<=.8+1e-10);
  const feasible=result.distribution.filter(x=>x.feasible);close(result.selected.cost,Math.min(...feasible.map(x=>x.cost)));
  close(result.gap,result.selected.cost-result.exact.cost);assert.equal(result.metrics.feasibleSamples,feasible.reduce((sum,x)=>sum+x.count,0));
  close(result.metrics.optimalFrequency,result.distribution.filter(x=>x.feasible&&Math.abs(x.cost-result.exact.cost)<1e-10).reduce((sum,x)=>sum+x.count,0)/1024);
  assert.ok(result.timing.retuneMs>=0);assert.ok(result.timing.samplingMs>=0);assert.ok(result.timing.referenceMs>=0);
  const previous=result.angles.slice(),warm=optimizeLocal(snapshot,previous,7);assert.ok(warm.metrics.warmStarted);assert.equal(warm.metrics.evaluations,48);assert.deepEqual(previous,result.angles);
  close(warm.metrics.initialExpectedCost,simulateQaoa(buildObjective(snapshot),previous).expectedCost);
});
test('no feasible shots holds current quantities and never substitutes exact optimizer',()=>{
  const snapshot=fixture(),none=optimizeLocal(snapshot,null,1,{sampleStates:Array(1024).fill(255)});
  assert.equal(none.selected,null);assert.equal(none.gap,null);assert.equal(none.metrics.feasibleRate,0);assert.equal(none.metrics.optimalFrequency,0);assert.match(none.holdReason,/Hold current/);assert.ok(none.exact);
  const counts=new Uint32Array(256);counts[0]=20;const onlyFlat=selectSampled(snapshot,counts);assert.equal(onlyFlat.selected.state,0);assert.notEqual(onlyFlat.exact.state,0);assert.ok(onlyFlat.gap>0);
});
test('custom tighter gross is honestly post-filtered, with one feasible reference and bounded selection',()=>{
  const snapshot=fixture({settings:{grossLimit:.2}}),result=optimizeLocal(snapshot,null,9);
  assert.ok(result.exact.breakdown.gross<=.2+1e-10);if(result.selected)assert.ok(result.selected.breakdown.gross<=.2+1e-10);
  const counts=new Uint32Array(256);counts[choicesToState([1,1,1,1])]=10;assert.equal(selectSampled(snapshot,counts).selected,null);
});
