import { cp, mkdir, rm } from 'node:fs/promises';
import { relative } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'brand.css', 'app.js', 'markets.html', 'markets.css', 'markets.js', 'market-model.mjs', 'market-feed.mjs', 'quantum.html', 'quantum.css', 'quantum.js', 'signals.html', 'signals.css', 'signals.js', 'signal-model.mjs', 'qswipe.css', 'experience.css', 'research-ui.mjs', 'sk-research.mjs', 'research.css', 'circuit-run.mjs', 'allocation-decision.mjs', 'circuit-run.css', 'project-guide.mjs', 'qswipe-ui.mjs', 'portfolio.css', 'portfolio-controller.mjs', 'portfolio-model.mjs', 'portfolio-market.mjs', 'paper-account.mjs', 'qaoa-worker.mjs', 'qollab', 'qollab-js', 'assets']) {
  await cp(path, `dist/${path}`, { recursive: true, filter: source => {
    if (!['qollab', 'qollab-js'].includes(path)) return true;
    const file = relative(path, source);
    return file === '' || (!file.includes('/') && /\.(py|json|txt|md|html|js|css)$/.test(file) && !/_result\.json$/.test(file));
  } });
}
await import('./qollab-kit.mjs');
console.log('Built QSwipe, joint portfolio lab, and Qollab starter in dist/');
