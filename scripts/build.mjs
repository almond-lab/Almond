import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'brand.css', 'app.js', 'markets.html', 'markets.css', 'markets.js', 'market-model.mjs', 'market-feed.mjs', 'quantum.html', 'quantum.css', 'quantum.js', 'signals.html', 'signals.css', 'signals.js', 'signal-model.mjs', 'qswipe.css', 'qswipe-ui.mjs', 'portfolio.css', 'portfolio-controller.mjs', 'portfolio-model.mjs', 'portfolio-market.mjs', 'paper-account.mjs', 'qaoa-worker.mjs', 'qollab', 'assets']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await import('./qollab-kit.mjs');
console.log('Built QSwipe, joint portfolio lab, and Qollab starter in dist/');
