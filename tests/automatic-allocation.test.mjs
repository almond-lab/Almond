import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioController } from '../portfolio-controller.mjs';
import { newPaperAccount, PAPER_COINS } from '../paper-account.mjs';
function controller(choices=[1,0,-1,0]) {
  const c=Object.create(PortfolioController.prototype), messages=[];
  Object.assign(c,{account:newPaperAccount(),version:0,latest:{snapshot:{id:'demo',version:0,createdAt:Date.now(),accountRevision:0,holdings:[0,0,0,0],experiment:{forceRebalance:true,previousChoices:[0,0,0,0]}},result:{selected:{choices}}},syncStoredSession(){},save(){},renderAccount(){},renderResult(){},status:m=>messages.push(m),circuitRun:{log(){}},allocationDecision:{error:m=>messages.push(m)},messages});
  c.fresh=()=>PAPER_COINS.map((coin,i)=>({coin,valid:true,collateralToken:0,decimals:5,mark:[100,200,50,300][i],oracle:[100,200,50,300][i],funding:0,bookTime:Date.now(),contextTime:Date.now(),bids:[{px:[100,200,50,300][i]-.01,sz:100000}],asks:[{px:[100,200,50,300][i]+.01,sz:100000}]}));return c;
}
test('successful demo allocation applies atomic paper fills automatically without a review plan',()=>{
  const c=controller();c.autoAllocate();assert.equal(c.account.revision,1);assert.equal(c.version,1);assert.equal(c.appliedSnapshot,'demo');assert.equal(c.account.ledger.length,1);assert(c.account.positions[0].qty>0);assert(c.account.positions[2].qty<0);assert(c.account.fees>0);assert(c.messages.at(-1).includes('Automatically allocated'));
});
test('a stale result or failed execution never applies an automatic rebalance',()=>{
  for(const failed of ['stale','quotes']){const c=controller(),before=structuredClone(c.account);if(failed==='stale')c.version++;else c.fresh=()=>{throw Error('Quotes expired');};c.autoAllocate();assert.deepEqual(c.account,before);assert.equal(c.appliedSnapshot,undefined);}
});
test('all-cash, unchanged and missing sampled targets cannot be substituted during automatic execution',()=>{
  for(const choices of [[0,0,0,0],[1,0,-1,0],null]){const c=controller(choices);if(choices?.some(x=>x))c.latest.snapshot.experiment.previousChoices=choices;if(!choices)c.latest.result.selected=null;const before=structuredClone(c.account);c.autoAllocate();assert.deepEqual(c.account,before);assert.equal(c.appliedSnapshot,undefined);}
});
