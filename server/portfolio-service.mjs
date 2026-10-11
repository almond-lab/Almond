import { createHash } from 'node:crypto';
import { handleQuantum, readReceipt, signReceipt } from './quantum-service.mjs';
import { DEFAULTS, makeSnapshot, optimizeLocal, buildIonQCircuit, buildObjective, selectSampled, compareWithHold, randomSamplingBaselines, seededRandom } from '../portfolio-model.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reply = (status, body) => Response.json(body, {status,headers:{'Cache-Control':'no-store'}});

// IonQ output_all bitstrings are converted to the model's little-endian integer
// states. A live X(q0) probe returns 10000000: IonQ v2 places q0 on the left.
export function sampleIonQProbabilities(artifact, shots, seed) {
  const raw=artifact?.probabilities?.registers?.output_all;
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('IonQ returned no supported probability register.');
  const probabilities=new Array(256).fill(0);
  for (const [bits,p] of Object.entries(raw)) {
    if (!/^[01]{8}$/.test(bits) || !Number.isFinite(p) || p<0 || p>1) throw new Error('IonQ returned an invalid probability distribution.');
    probabilities[parseInt([...bits].reverse().join(''),2)]=p;
  }
  const total=probabilities.reduce((a,b)=>a+b,0);
  // Live IonQ artifacts can omit small probabilities. Reject substantial missing
  // mass, and normalize only the provider-returned support; never invent states.
  if (total<.95 || total>1.00001) throw new Error('IonQ probability mass is incomplete or invalid.');
  for(let state=0;state<256;state++)probabilities[state]/=total;
  const counts=new Uint32Array(256), rng=seededRandom(`${seed}:ionq`);
  for(let i=0;i<shots;i++){const draw=rng();let sum=0;for(let state=0;state<256;state++){sum+=probabilities[state];if(draw<sum){counts[state]++;break;}}}
  return {counts,probabilities,returnedProbabilityMass:total};
}

export function createPortfolioService({env=process.env,fetcher=globalThis.fetch,now=Date.now}={}) {
  const submissions=new Map();
  let windowStart=0, submissionsInWindow=0;
  return async function handlePortfolio(request) {
    if(request.method==='GET')return reply(200,{provider:'IonQ',backend:'simulator',ready:Boolean(env.IONQ_API_KEY&&env.ALMOND_EXECUTION_TOKEN?.length>=32),mode:'ionq-ideal-cloud-simulator',training:'48 classical expectation evaluations; one IonQ final-circuit job'});
    if(request.method!=='POST')return reply(405,{message:'Use POST to optimize a portfolio.'});
    try {
      const origin=request.headers.get('origin');
      if(origin && origin!==new URL(request.url).origin)return reply(403,{message:'Use QSwipe on this site.'});
      if(!env.IONQ_API_KEY || env.ALMOND_EXECUTION_TOKEN?.length<32 || !env.ALMOND_EXECUTION_TOKEN)return reply(503,{message:'The IonQ simulator needs server-side credentials. Current paper positions are held.'});
      if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,{message:'Send JSON.'});
      const text=await request.text();if(Buffer.byteLength(text)>32768)return reply(413,{message:'Snapshot exceeds 32 KB.'});
      const body=JSON.parse(text);
      const snapshot=makeSnapshot({...body.snapshot,settings:DEFAULTS});
      const snapshotHash=hash(snapshot);
      const call=async payload=>{
        const res=await handleQuantum(new Request(new URL('/api/quantum',request.url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.ALMOND_EXECUTION_TOKEN}`},body:JSON.stringify(payload)}),{env:{...env,IONQ_BACKEND:'simulator',ALMOND_ALLOW_QPU:'false'},fetcher,now});
        const value=await res.json();if(!res.ok){const error=new Error(value.message);error.status=res.status;throw error;}return value;
      };
      if(body.action==='submit') {
        if(Math.abs(now()-snapshot.createdAt)>60000)return reply(400,{message:'Freeze a fresh snapshot before submitting.'});
        const key=hash({snapshotHash,previousAngles:body.previousAngles??null});
        if(submissions.has(key))return reply(202,await submissions.get(key));
        if(now()-windowStart>=60000){windowStart=now();submissionsInWindow=0;}
        if(submissionsInWindow>=10)return reply(429,{message:'Simulator submissions are busy. Try again in a minute.'});
        submissionsInWindow++;
        const promise=(async()=>{
          const seed=Number.isSafeInteger(snapshot.localSeed)?snapshot.localSeed:1;
          const tuned=optimizeLocal(snapshot,body.previousAngles??null,seed);
          const created=await call({action:'submit',circuit:buildIonQCircuit(snapshot,tuned.angles),name:'QSwipe joint portfolio',shots:1024});
          const receipt=signReceipt({id:created.job.id,createdAt:now(),snapshotHash,innerReceipt:created.receipt,angles:tuned.angles,seed,metrics:tuned.metrics,timing:tuned.timing,resources:tuned.resources},env.ALMOND_EXECUTION_TOKEN);
          return {job:created.job,receipt,snapshotId:snapshot.id,angles:tuned.angles,training:tuned.metrics.training};
        })();
        submissions.set(key,promise);if(submissions.size>100)submissions.delete(submissions.keys().next().value);
        // Keep a failed submission cached too: an uncertain POST must not be silently retried.
        return reply(202,await promise);
      }
      if(body.action==='status') {
        const frozen=readReceipt(body.receipt,env.ALMOND_EXECUTION_TOKEN,now());
        if(frozen.snapshotHash!==snapshotHash)return reply(409,{message:'This job belongs to a different frozen snapshot.'});
        const response=await call({action:'status',receipt:frozen.innerReceipt});
        if(response.job.backend!=='simulator')return reply(502,{message:'Expected the IonQ simulator backend.'});
        if(!response.results)return reply(200,{job:response.job,result:null,note:response.resultsNote});
        const samplingStarted=performance.now();
        const {counts,probabilities,returnedProbabilityMass}=sampleIonQProbabilities(response.results,1024,frozen.seed);
        const samplingMs=performance.now()-samplingStarted, referenceStarted=performance.now();
        const objective=buildObjective(snapshot),outcome=selectSampled(snapshot,counts,objective);
        const referenceMs=performance.now()-referenceStarted;
        const result={snapshotId:snapshot.id,snapshotVersion:snapshot.version,seed:frozen.seed,angles:frozen.angles,...outcome,
          holdComparison:compareWithHold(snapshot,outcome.selected),randomBaselines:randomSamplingBaselines(snapshot,frozen.seed),
          metrics:{...frozen.metrics,...outcome.metrics,expectedCost:probabilities.reduce((sum,p,state)=>sum+p*objective.evaluateState(state),0),normalization:probabilities.reduce((a,b)=>a+b,0)},
          resources:frozen.resources,timing:{...frozen.timing,samplingMs,referenceMs,totalMs:now()-frozen.createdAt+frozen.timing.retuneMs},
          execution:{provider:'IonQ',backend:'simulator',jobId:response.job.id,providerExecutionMs:response.job.providerExecutionMs,submittedAt:response.job.submittedAt,completedAt:response.job.completedAt,sampling:'1,024 seeded classical draws from normalized IonQ-returned probabilities',returnedProbabilityMass,probabilityNote:Math.abs(returnedProbabilityMass-1)>1e-5?`IonQ returned probability mass ${returnedProbabilityMass.toFixed(6)}. Samples normalize only that returned support; omitted states are not filled in.`:'Provider probabilities sum to one within tolerance.',probabilities},
          methodology:'Classical fixed-budget angle tuning; IonQ ideal cloud simulator executes the final frozen circuit. CPU sampling of provider probabilities; no hardware or speedup claim.',
          benchmarkBudgetNote:'Random baselines match 1,024 final draws only. QAOA also uses 48 classical training evaluations and one IonQ cloud simulation job; queue and network time are included in wall time.'};
        return reply(200,{job:response.job,result});
      }
      return reply(400,{message:'Choose submit or status.'});
    }catch(error){return reply(error.status??400,{message:error.status?error.message:'The simulator request or returned result is invalid. Current positions are held.'});}
  };
}
export const handlePortfolio=createPortfolioService();
