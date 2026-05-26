import type { Repository } from '../data/repository.js';
import type { PriceSeries, PricePoint } from '../types.js';
import { toIsoDate } from '../utils/ids.js';

const STALE_HOURS = 12;
export const SP500_SYMBOL = '^GSPC';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isStale(updatedAt: string): boolean {
  const ms = Date.now() - new Date(updatedAt).getTime();
  return ms > STALE_HOURS * 3_600_000;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: { currency?: string; symbol: string };
      timestamp?: number[];
      indicators: { quote?: Array<{ close?: (number | null)[] }>; adjclose?: Array<{ adjclose?: (number | null)[] }> };
    }>;
    error?: { code: string; description: string } | null;
  };
}

/** Naive sequential queue to avoid hammering Yahoo. */
class FetchQueue {
  private chain: Promise<unknown> = Promise.resolve();
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next as Promise<T>;
  }
}

const queue = new FetchQueue();

async function fetchYahooChart(symbol: string, from: Date, to: Date): Promise<YahooChartResponse> {
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(to.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json,text/plain,*/*',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
        lastErr = new Error(`Yahoo HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as YahooChartResponse;
      } catch {
        throw new Error(`Yahoo non-JSON response (status ${res.status}): ${text.slice(0, 80)}`);
      }
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('Yahoo fetch failed');
}

export class MarketDataService {
  constructor(private readonly repo: Repository) {}

  async getHistory(symbol: string, since?: string): Promise<PriceSeries> {
    if (!symbol || typeof symbol !== 'string') {
      return { symbol: String(symbol ?? ''), currency: 'EUR', updatedAt: new Date().toISOString(), points: [] };
    }
    const cached = await this.repo.priceCache.get(symbol);
    if (cached && !isStale(cached.updatedAt)) return cached;

    const fromDate = since ? new Date(since) : new Date('2000-01-01');
    const toDate = new Date();
    let points: PricePoint[] = [];
    let currency = 'USD';
    try {
      const data = await queue.enqueue(() => fetchYahooChart(symbol, fromDate, toDate));
      const result = data.chart.result?.[0];
      if (!result) {
        const desc = data.chart.error?.description ?? 'no result';
        throw new Error(desc);
      }
      currency = result.meta.currency ?? 'USD';
      const timestamps = result.timestamp ?? [];
      const closes = result.indicators.quote?.[0]?.close ?? [];
      const adjcloses = result.indicators.adjclose?.[0]?.adjclose ?? [];
      const series: PricePoint[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const close = adjcloses[i] ?? closes[i];
        if (close == null) continue;
        series.push({ date: toIsoDate(new Date(timestamps[i] * 1000)), close: Number(close) });
      }
      points = series;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[market] Failed to fetch ${symbol}:`, (err as Error).message);
      if (cached) return cached;
    }

    const out: PriceSeries = {
      symbol,
      currency,
      updatedAt: new Date().toISOString(),
      points,
    };
    if (points.length > 0) {
      await this.repo.priceCache.put(out);
    }
    return out;
  }

  /**
   * Build a price-at-date lookup using forward fill (last known close).
   */
  static toLookup(series: PriceSeries): (isoDate: string) => number | undefined {
    if (series.points.length === 0) return () => undefined;
    const sorted = [...series.points].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map((p) => p.date);
    const closes = sorted.map((p) => p.close);
    return (isoDate: string) => {
      let lo = 0;
      let hi = dates.length - 1;
      if (isoDate < dates[0]) return undefined;
      if (isoDate >= dates[hi]) return closes[hi];
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (dates[mid] <= isoDate) lo = mid; else hi = mid - 1;
      }
      return closes[lo];
    };
  }
}

