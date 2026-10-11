import { seededRandom, simulateQaoa } from './portfolio-model.mjs';

/** Finite zero-field Gaussian SK companion to Eq. (1.1), not the asymptotic compiler. */
export function makeSKInstance(seed=42) {
  const rng=seededRandom(seed), n=8, pairs=[];
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    const gaussian=Math.sqrt(-2*Math.log(1-rng()))*Math.cos(2*Math.PI*rng());
    pairs.push({i,j,J:gaussian});
  }
  const energies=Array.from({length:256},(_,state)=>pairs.reduce((sum,{i,j,J})=>sum+J*((state>>i)&1?-1:1)*((state>>j)&1?-1:1),0)/Math.sqrt(n));
  return {seed,n,pairs,energies};
}
export function runSK(instance,{layers=2,budget=48,shots=1024,seed=731}={}) {
  if(![1,2].includes(layers)||!Number.isInteger(budget)||budget<1||budget>48||!Number.isInteger(shots)||shots<1||shots>4096)throw new RangeError('Use 1–2 layers, 1–48 evaluations and 1–4096 shots');
  if(instance.n!==8||instance.energies.length!==256||instance.energies.some(e=>!Number.isFinite(e)))throw new TypeError('An eight-spin finite SK instance is required');
  const started=performance.now(),costs=instance.energies.map(e=>-e),rng=seededRandom(seed);
  let angles=Array.from({length:layers},(_,i)=>[.17+i*.11,.31-i*.04]).flat(),best=simulateQaoa(costs,angles);
  const initialExpectedEnergy=-best.expectedCost;
  for(let evaluation=1;evaluation<budget;evaluation++) {
    const proposal=angles.slice(),index=(evaluation-1)%proposal.length,round=Math.floor((evaluation-1)/(proposal.length*2));
    proposal[index]+=((evaluation-1)%(proposal.length*2)<proposal.length?1:-1)*.38*.8**round;
    if(evaluation%9===0)for(let i=0;i<proposal.length;i++)proposal[i]+=(rng()-.5)*.3;
    const candidate=simulateQaoa(costs,proposal);
    if(candidate.expectedCost<best.expectedCost){best=candidate;angles=proposal;}
  }
  const counts=new Uint32Array(256),cdf=[];let cumulative=0;
  for(const p of best.probabilities){cumulative+=p/best.normalization;cdf.push(cumulative);}
  for(let shot=0;shot<shots;shot++){const u=rng();let state=0;while(state<255&&u>=cdf[state])state++;counts[state]++;}
  let exactState=0,sampledState=null;
  for(let state=0;state<256;state++) {
    if(instance.energies[state]>instance.energies[exactState])exactState=state;
    if(counts[state]&&(sampledState===null||instance.energies[state]>instance.energies[sampledState]))sampledState=state;
  }
  const expectedEnergy=-best.expectedCost,sampledEnergy=instance.energies[sampledState],exactEnergy=instance.energies[exactState];
  return {model:'Finite zero-field Gaussian SK; positive-energy maximization, Eq. (1.1)',instanceSeed:instance.seed,sampleSeed:seed,n:8,layers,evaluations:budget,shots,angles,expectedEnergy,initialExpectedEnergy,sampledEnergy,exactEnergy,sampledState,exactState,sampledCount:counts[sampledState],gapPerSpin:Math.max(0,(exactEnergy-sampledEnergy)/8),expectedPerSpin:expectedEnergy/8,sampledPerSpin:sampledEnergy/8,exactPerSpin:exactEnergy/8,normalization:best.normalization,counts:Array.from(counts),probabilities:best.probabilities,totalMs:performance.now()-started,scope:'Classical finite-instance state-vector simulation with instance-tuned angles. Not a test of the thermodynamic-first theorem, a proof-derived angle schedule, or quantum speedup.'};
}
