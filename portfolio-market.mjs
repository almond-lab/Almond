import { HyperliquidFeed } from './market-feed.mjs';
import { PAPER_COINS } from './paper-account.mjs';

export class PortfolioMarket {
  constructor(onChange) { this.onChange = onChange; this.contexts = new Map(); this.feed = new HyperliquidFeed(() => onChange()); }
  async start() { this.stopped = false; this.contextTimer = setInterval(() => this.refreshContexts(), 30_000); await Promise.allSettled([this.feed.start(), this.refreshContexts()]); }
  async refreshContexts() {
    if (this.pending || this.stopped) return;
    this.pending = true;
    try { await Promise.all(['', 'xyz'].map(async dex => {
      const raw = await this.feed.info({ type: 'metaAndAssetCtxs', dex });
      for (let i = 0; i < (raw[0]?.universe?.length || 0); i++) {
        const asset = raw[0].universe[i], ctx = raw[1]?.[i];
        if (!PAPER_COINS.includes(asset.name) || !ctx) continue;
        this.contexts.set(asset.name, { valid: !asset.isDelisted && raw[0].collateralToken === 0, collateralToken: raw[0].collateralToken, decimals: asset.szDecimals, mark: Number(ctx.markPx), oracle: Number(ctx.oraclePx), funding: Number(ctx.funding), contextTime: Date.now() });
      }
    })); } catch { /* Keep timestamps; stale contexts block optimization/fills. */ }
    finally { this.pending = false; this.onChange(); }
  }
  values() {
    return PAPER_COINS.map(coin => {
      const source = this.feed.books.get(coin), context = this.contexts.get(coin);
      return { coin, ...context, valid: Boolean(context?.valid && this.feed.available.get(coin)?.valid), bookTime: source?.book.time || 0, received: source?.received || 0, bids: source?.book.levels[0] || [], asks: source?.book.levels[1] || [] };
    });
  }
  stop() { this.stopped = true; clearInterval(this.contextTimer); this.feed.stop(); }
}
