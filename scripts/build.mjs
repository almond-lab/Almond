import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'app.js', 'markets.html', 'markets.css', 'markets.js', 'market-model.mjs', 'market-feed.mjs', 'quantum.html', 'quantum.css', 'quantum.js', 'assets']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log('Built Almond landing page, trading lab, and circuit runner in dist/');
