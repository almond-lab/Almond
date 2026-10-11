export function canReviewAllocation({selected, running, historical, ready, applied=false}) {
  return !!selected && !running && !historical && !!ready && !applied;
}

/** A completed sampled proposal always has a visible next action or reason. */
export class AllocationDecision {
  constructor(anchor, review) {
    this.root=document.createElement('section');this.root.className='allocation-decision';this.root.hidden=true;
    this.root.setAttribute('aria-label','Allocate joint paper portfolio');
    this.root.innerHTML=`<div class="run-heading"><div><p class="eyebrow">YOUR JOINT PORTFOLIO / PAPER ONLY</p><h2>Automatic paper allocation.</h2></div><span class="decision-badge small-pill"></span></div><div class="decision-targets"></div><p class="decision-reason" role="status"></p><p class="decision-cost portfolio-note"></p><button class="button button-primary decision-allocate" type="button">Optimize again ↗</button><p class="portfolio-note">Each successful demo run automatically applies its sampled changed target. Inspect positions and fees in Portfolio.</p>`;
    anchor.after(this.root);this.root.querySelector('button').addEventListener('click',review);
  }
  error(message) { this.root.querySelector('.decision-reason').textContent=`Allocation failed: ${message}`; }
  render({result,running,historical,ready,applied}) {
    this.root.hidden=!result || running;
    if(!result || running)return;
    const selected=result.selected, button=this.root.querySelector('button');
    this.root.querySelector('.decision-badge').textContent=applied?'AUTO ALLOCATED':historical?'STALE SNAPSHOT':selected?'SAMPLED PROPOSAL':'NO FEASIBLE SAMPLE';
    const targets=this.root.querySelector('.decision-targets');targets.replaceChildren();
    ['BTC','S&P 500','Brent','Gold'].forEach((name,i)=>{const tile=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=name;const choice=selected?.choices[i];value.textContent=choice===undefined?'—':choice===0?'Flat / 0%':`${choice>0?'Long':'Short'} / 20%`;tile.append(label,value);targets.append(tile);});
    this.root.querySelector('.decision-reason').textContent=applied?'Changed portfolio automatically allocated. Check your paper positions and ledger in Portfolio.':historical?'Beliefs, positions or snapshot age changed. Optimize again to allocate a fresh proposal.':!selected?'No feasible portfolio was sampled. Your current positions are held; optimize again.':!ready?'Waiting for fresh execution quotes across all four instruments.':'Executing the sampled demo target with fresh quotes and paper risk checks.';
    this.root.querySelector('.decision-cost').textContent=selected?`Sampled cost ${selected.cost.toFixed(4)} · exact reference ${result.exact.cost.toFixed(4)} · optimality gap ${result.gap.toFixed(4)}. Demo constraint: non-flat and different from current allocation.`:'';
    button.disabled=running || !ready;
    button.textContent='Optimize again ↗';
  }
}
