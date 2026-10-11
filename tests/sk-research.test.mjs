import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSKInstance, runSK } from '../sk-research.mjs';

test('the finite SK companion uses 28 seeded Gaussian pairs, zero field, and 1/sqrt(n) scaling',()=>{
  const a=makeSKInstance(42),b=makeSKInstance(42),other=makeSKInstance(43);
  assert.deepEqual(a,b);assert.notDeepEqual(a.pairs,other.pairs);assert.equal(a.pairs.length,28);
  assert.equal(new Set(a.pairs.map(p=>`${p.i}:${p.j}`)).size,28);
  const allPlus=a.pairs.reduce((sum,p)=>sum+p.J,0)/Math.sqrt(8);
  assert(Math.abs(a.energies[0]-allPlus)<1e-12);
  for(let state=0;state<256;state++)assert(Math.abs(a.energies[state]-a.energies[state^255])<1e-12,'Global spin flip symmetry requires zero field');
  assert(Math.abs(a.energies.reduce((sum,e)=>sum+e,0)/256)<1e-12,'Uniform state has zero SK expectation');
});
test('SK expected energies and sampled results use the paper positive-energy convention with an independent exact optimum',()=>{
  for(const layers of [1,2]) {
    const instance=makeSKInstance(42),r=runSK(instance,{layers});
    assert.equal(r.counts.reduce((sum,c)=>sum+c,0),1024);assert.equal(r.evaluations,48);
    assert(r.counts[r.sampledState]>0);assert.equal(r.sampledCount,r.counts[r.sampledState]);
    assert.equal(r.sampledEnergy,Math.max(...instance.energies.filter((_,i)=>r.counts[i]>0)));
    assert.equal(r.exactEnergy,Math.max(...instance.energies));
    assert(Math.abs(r.normalization-1)<1e-12);
    const expectation=instance.energies.reduce((sum,e,i)=>sum+e*r.probabilities[i],0);
    assert(Math.abs(expectation-r.expectedEnergy)<1e-12);
    assert(r.expectedEnergy>=r.initialExpectedEnergy-1e-12);assert(r.expectedEnergy<=r.exactEnergy+1e-12);
    assert.equal(r.gapPerSpin,(r.exactEnergy-r.sampledEnergy)/8);
    const repeat=runSK(instance,{layers});assert.deepEqual(repeat.counts,r.counts);assert.deepEqual(repeat.angles,r.angles);
  }
});
test('SK companion keeps execution bounded and rejects unsupported sizes',()=>{
  const instance=makeSKInstance(1);
  for(const options of [{layers:3},{budget:49},{shots:4097},{shots:0}])assert.throws(()=>runSK(instance,options),RangeError);
  assert.throws(()=>runSK({...instance,n:9}),TypeError);
});
