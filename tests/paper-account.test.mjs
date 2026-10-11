import test from 'node:test';
import assert from 'node:assert/strict';
import { PAPER_COINS, newPaperAccount, accountMetrics, consumeBook, planPaperRebalance, restorePaperAccount } from '../paper-account.mjs';

const now = 1_900_000_000_000;
function markets(prices = [100,200,50,300]) {
  return PAPER_COINS.map((coin,i)=>({ coin,valid:true,collateralToken:0,decimals:5,mark:prices[i],oracle:prices[i],funding:.00001,bookTime:now,contextTime:now,bids:[{px:prices[i]-.01,sz:100_000}],asks:[{px:prices[i]+.01,sz:100_000}] }));
}
const plan = (account,choices,values=markets()) => planPaperRebalance(account,choices,values,{now,snapshotId:'test-frozen'});

test('joint paper rebalance is atomic, consumes the correct book sides and meets post-fee risk limits',()=>{
  const original=newPaperAccount(), frozen=structuredClone(original), p=plan(original,[1,0,-1,1]);
  assert.deepEqual(original,frozen);
  assert.equal(p.legs.length,3); assert.equal(p.next.revision,1);
  assert.equal(p.legs[0].side,'buy'); assert.equal(p.legs[0].price,100.01);
  assert.equal(p.legs[1].side,'sell'); assert.equal(p.legs[1].price,49.99);
  assert(p.metrics.gross<=.8); assert(p.metrics.availableMargin>=0);
  for(const [i,pos]of p.next.positions.entries())assert(Math.abs(pos.qty)*markets()[i].mark<=p.metrics.equity*.2+1e-7);
  assert(Math.abs(p.next.balance-(10_000-p.next.fees))<1e-8);
  assert(p.metrics.unrealized<0);
  assert.equal(p.next.ledger[0].snapshotId,'test-frozen');
});
test('all four slots remain below 80% after costs and precision rounding',()=>{
  const p=plan(newPaperAccount(),[1,-1,1,-1]);
  assert(p.metrics.gross<=.8);assert(p.metrics.gross>.79);assert(p.next.fees>3.9);
  p.next.positions.forEach(pos=>assert(Math.abs(pos.qty*1e5-Math.round(pos.qty*1e5))<1e-7));
});
test('flipping closes the original entry, realizes P&L and charges both legs of turnover',()=>{
  const a=plan(newPaperAccount(),[1,0,0,0]).next;
  const oldQty=a.positions[0].qty, oldEntry=a.positions[0].entry;
  const p=plan(a,[-1,0,0,0],markets([110,200,50,300])); const l=p.legs[0];
  assert.equal(l.side,'sell');assert(l.filledQty>oldQty);
  assert(Math.abs(l.realized-oldQty*(109.99-oldEntry))<1e-8);
  assert.equal(p.next.positions[0].entry,109.99);
  assert(Math.abs(l.fee-l.filledQty*109.99*.0005)<1e-9);
  assert(Math.abs(p.next.balance-(a.balance+l.realized-l.fee))<1e-8);
  assert.equal(p.next.ledger.length,2);
});
test('flat no-change is valid without fills, fees, revision or ledger entry',()=>{
  const a=newPaperAccount(),p=plan(a,[0,0,0,0]);assert(p.noChange);assert.deepEqual(p.next,a);assert.deepEqual(p.legs,[]);
});
test('visible-depth execution computes VWAP and rejects incomplete fills',()=>{
  const fill=consumeBook([{px:100,sz:1},{px:101,sz:2}],2);
  assert.equal(fill.price,100.5);assert.equal(fill.notional,201);assert.equal(fill.fills.length,2);
  assert.throws(()=>consumeBook([{px:100,sz:1}],2),/Visible liquidity/);
});
test('stale, missing timestamps, ineligible collateral, spread guard and insufficient depth hold all positions',()=>{
  const a=newPaperAccount(),copy=structuredClone(a);
  for(const mutate of [m=>m[3].bookTime=now-15_001,m=>delete m[0].bookTime,m=>m[1].collateralToken=1,m=>m[2].asks[0].px=51,m=>m[3].asks[0].sz=.0001]){
    const m=markets();mutate(m);assert.throws(()=>plan(a,[1,1,1,1],m));assert.deepEqual(a,copy);
  }
});
test('valuation separates balance from unrealized positions and restore rejects malformed holdings',()=>{
  const a=plan(newPaperAccount(),[1,0,0,0]).next;
  const m=accountMetrics(a,[110,200,50,300]);assert.equal(m.equity,a.balance+a.positions[0].qty*(110-a.positions[0].entry));
  assert.equal(m.margin,Math.abs(a.positions[0].qty)*110);
  assert.deepEqual(restorePaperAccount(a),a);
  const bad=structuredClone(a);bad.positions[0].entry=NaN;assert.deepEqual(restorePaperAccount(bad),newPaperAccount());
});
