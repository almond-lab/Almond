import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioController } from '../portfolio-controller.mjs';
import { newPaperAccount } from '../paper-account.mjs';

function session(t, stored) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>stored==null?null:JSON.stringify(stored)}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  const controller=Object.create(PortfolioController.prototype);
  Object.assign(controller,{events:[],account:newPaperAccount(),version:0,pending:new Set(),angles:null,
    active:{snapshot:{id:'old'}},running:true,latest:{snapshot:{id:'old'}},pendingPlan:{version:0},
    invalidatedByOtherTab:true,status(){},renderAccount(){},renderConvictions(){},renderResult(){}});
  return controller;
}

test('another tab can deliver a ten-view batch without leaving the optimizer locked',t=>{
  const events=Array.from({length:10},(_,i)=>({id:`view-${i}`,coin:i<5?'BTC':'xyz:SP500',direction:1,thesis:'general-outlook',at:Date.now()}));
  const controller=session(t,{schema:1,version:10,events,pending:events.map(e=>e.id),account:newPaperAccount(),angles:null});
  assert.equal(controller.syncStoredSession(),true);
  assert.equal(controller.pending.size,10);
  assert.equal(controller.version,10);
  assert.equal(controller.running,false);
  assert.equal(controller.invalidatedByOtherTab,false);
  assert.equal(controller.latest,null);
  assert.equal(controller.active,null);
  assert.equal(controller.pendingPlan,null);
});

test('angle-only updates on identical beliefs and holdings do not cancel a local solve',t=>{
  const controller=session(t,{schema:1,version:0,events:[],pending:[],account:newPaperAccount(),angles:[.7,.3,1.1,.5]});
  const active=controller.active;
  assert.equal(controller.syncStoredSession(),false);
  assert.equal(controller.active,active);
  assert.equal(controller.running,true);
});

test('paper confirmation rechecks shared account state before any fill can apply',t=>{
  const account=newPaperAccount();account.revision=1;account.balance=9999;
  const controller=session(t,{schema:1,version:1,events:[],pending:[],account,angles:null});
  controller.fresh=()=>{throw Error('A stale confirmation must not reach execution planning');};
  controller.apply();
  assert.equal(controller.account.balance,9999);
  assert.equal(controller.account.revision,1);
  assert.equal(controller.pendingPlan,null);
  assert.deepEqual(controller.account.ledger,[]);
});

test('missing persistence does not silently erase a session held only in memory',t=>{
  const controller=session(t,null);
  controller.version=7;controller.account.balance=9876;
  assert.equal(controller.syncStoredSession(),false);
  assert.equal(controller.version,7);
  assert.equal(controller.account.balance,9876);
});

test('progress preserves an active solve and ignores telemetry from stale snapshots',()=>{
  const controller=Object.create(PortfolioController.prototype), progress=[];
  Object.assign(controller,{active:{snapshot:{id:'current'}},running:true,circuitRun:{progress:e=>progress.push(e)}});
  controller.receive({type:'progress',snapshotId:'old',progress:{percent:10}});
  assert.deepEqual(progress,[]);
  controller.receive({type:'progress',snapshotId:'current',progress:{percent:40}});
  assert.equal(controller.running,true);
  assert.equal(controller.latest,undefined);
  assert.deepEqual(progress,[{percent:40}]);
});
