import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewAllocation } from '../allocation-decision.mjs';

test('a flat or below-threshold feasible sampled result remains available for manual review',()=>{
  for(const choices of [[0,0,0,0],[1,0,-1,0]]) {
    assert.equal(canReviewAllocation({selected:{choices},ready:true,historical:false,running:false,holdComparison:{eligible:false}}),true);
  }
});
test('missing samples, stale inputs, stale quotes, running solves and already confirmed results cannot allocate',()=>{
  const ready={selected:{choices:[1,0,-1,0]},ready:true,historical:false,running:false};
  for(const patch of [{selected:null},{ready:false},{historical:true},{running:true},{applied:true}]) {
    assert.equal(canReviewAllocation({...ready,...patch}),false);
  }
});
