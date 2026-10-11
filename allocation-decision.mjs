export function canReviewAllocation({selected, running, historical, ready, applied=false}) {
  return !!selected && !running && !historical && !!ready && !applied;
}

/** A completed sampled proposal always has a visible next action or reason. */
export class AllocationDecision {
  constructor(anchor, review) {
    this.root=document.createElement('section');this.root.className='allocation-decision';this.root.hidden=true;
    this.root.setAttribute('aria-label','Allocate joint paper portfolio');
    this.root.innerHTML=`<div class="run-heading"><div><p class="eyebrow">YOUR JOINT PORTFOLIO / PAPER ONLY</p><h2>From proposal to positions.</h2></div><span class="decision-badge small-pill"></span></div><div class="decision-targets"></div><p class="decision-reason" role="status"></p><p class="decision-cost portfolio-note"></p><button class="button button-primary decision-allocate" type="button">Allocate Portfolio ↗</button><p class="portfolio-note">Review the simulated fills and fees, then confirm. Nothing is allocated automatically.</p>`;
    anchor.after(this.root);this.root.querySelector('button').addEventListener('click',review);
  }
  render({result,running,historical,ready,applied}) {
    this.root.hidden=!result || running;
    if(!result || running)return;
    const selected=result.selected, button=this.root.querySelector('button');
    this.root.querySelector('.decision-badge').textContent=applied?'CONFIRMED':historical?'STALE SNAPSHOT':selected?'SAMPLED PROPOSAL':'NO FEASIBLE SAMPLE';
    const targets=this.root.querySelector('.decision-targets');targets.replaceChildren();
    ['BTC','S&P 500','Brent','Gold'].forEach((name,i)=>{const tile=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=name;const choice=selected?.choices[i];value.textContent=choice===undefined?'—':choice===0?'Flat / 0%':`${choice>0?'Long':'Short'} / 20%`;tile.append(label,value);targets.append(tile);});
    const below=result.holdComparison?.eligible===false;
    this.root.querySelector('.decision-reason').textContent=applied?'Portfolio confirmed. Check your paper positions and ledger in Portfolio.':historical?'Beliefs, positions or snapshot age changed. Optimize again to allocate a fresh proposal.':!selected?'No feasible portfolio was sampled. Your current positions are held; optimize again.':!ready?'Waiting for fresh execution quotes across all four instruments.':selected.choices.every(x=>x===0)?'The sampled target is all cash. You can confirm this result; an already-flat account needs no fills or fees.':below?'The model recommends holding: this sampled target does not clear the minimum cost improvement. You may explicitly review and confirm it anyway.':'Your sampled portfolio is ready. Review the rebalance, then confirm allocation to your paper account.';
    this.root.querySelector('.decision-cost').textContent=selected?`Sampled cost ${selected.cost.toFixed(4)} · exact reference ${result.exact.cost.toFixed(4)} · optimality gap ${result.gap.toFixed(4)}. ${below?'Hold threshold not met; manual confirmation is required.':''}`:'';
    button.disabled=!canReviewAllocation({selected,running,historical,ready,applied});
    button.textContent=applied?'Portfolio confirmed ✓':'Allocate Portfolio ↗';
  }
}
