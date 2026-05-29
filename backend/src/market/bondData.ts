/**
 * Bond market data from simpletoolsforinvestors.eu.
 *
 * The site exports a CSV archive (~45 MB) of historical clean prices for Italian
 * Borsa Italiana / EuroTLX bonds, keyed by ISIN. The clean prices are quoted as
 * percentages of nominal value (matching the "Bond.priceConvention === 'percent'"
 * convention used elsewhere in the codebase).
 *
 * We download the archive on first need, cache it on disk, refresh every 24 h
 * and build per-ISIN price series lazily.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config } from '../config.js';
import type { PricePoint, PriceSeries } from '../types.js';
import type { Repository } from '../data/repository.js';

const SOURCE_PAGE = 'https://www.simpletoolsforinvestors.eu/documentivari.php';
// Historical fallback URL — the site rotates this filename periodically (it's a
// content hash of the day's build), so we always try to scrape the current one
// from the documents page first. The fallback is only used if the page is
// unreachable; if both fail we let the error bubble up so callers can see it.
const KNOWN_HISTORICAL_URL_FALLBACK = 'https://www.simpletoolsforinvestors.eu/data/export/A7D5EA3ABAF9EB17CD40B09B5A8A5680.csv.zip';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const STALE_HOURS = 24;

interface BundleState {
  parsedAt: number;
  byIsin: Map<string, PricePoint[]>;
}

let inMemoryBundle: BundleState | null = null;
let pendingLoad: Promise<BundleState> | null = null;

function cacheDir(): string {
  return config.cacheDir;
}
function csvPath(): string {
  return path.join(cacheDir(), 'bonds_historical_prices.csv');
}
function stampPath(): string {
  return path.join(cacheDir(), 'bonds_historical_prices.timestamp');
}

async function isCacheFresh(): Promise<boolean> {
  try {
    const ts = await fs.readFile(stampPath(), 'utf8');
    const age = Date.now() - new Date(ts.trim()).getTime();
    return Number.isFinite(age) && age < STALE_HOURS * 3_600_000;
  } catch {
    return false;
  }
}

async function findHistoricalCsvUrl(): Promise<string> {
  // The page lists download links in a table. The relevant row looks like:
  //   <tr>
  //     <td>Archivio con lo storico prezzi dei titoli in formato CSV(Ultimo aggiornamento: dd/MM/yyyy)</td>
  //     <td><a href='data/export/XXXXXXXX.csv.zip'>Link</a></td>
  //   </tr>
  // Notes vs. older versions of the markup:
  //   * the description text and the href live in two *separate* <td> cells;
  //   * the href uses single quotes (the site emits `href='...'`, not `href="..."`).
  // We anchor on the description text inside one cell, then non-greedily jump
  // to the next href in the same row. The {0,400} bound keeps us within the
  // same table row.
  try {
    const res = await fetch(SOURCE_PAGE, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(
        /[Aa]rchivio[^<]*storico[^<]*prezzi[\s\S]{0,400}?href=['"]([^'"]*data\/export\/[A-Fa-f0-9]+\.csv\.zip)['"]/
      );
      if (match) return new URL(match[1], SOURCE_PAGE).toString();
      // eslint-disable-next-line no-console
      console.warn('[bondData] could not locate historical archive link on documents page; falling back to last known URL');
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[bondData] documents page returned HTTP ${res.status}; falling back to last known URL`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[bondData] failed to fetch documents page:', (err as Error).message);
  }
  return KNOWN_HISTORICAL_URL_FALLBACK;
}

async function unzipFirstEntry(zipBuf: Uint8Array): Promise<string> {
  // Minimal ZIP reader: find the first local-file header, gunzip its content.
  // ZIP local header: 50 4B 03 04, compression method at offset 8 (DEFLATE = 8).
  const view = new DataView(zipBuf.buffer, zipBuf.byteOffset, zipBuf.byteLength);
  // Validate signature
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Not a ZIP archive (bad signature)');
  }
  const compMethod = view.getUint16(8, true);
  const compSize = view.getUint32(18, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = 30 + nameLen + extraLen;
  const compBytes = zipBuf.subarray(dataStart, dataStart + compSize);
  if (compMethod === 0) {
    return Buffer.from(compBytes).toString('utf8');
  }
  if (compMethod !== 8) {
    throw new Error(`Unsupported ZIP compression method ${compMethod}`);
  }
  // Inflate raw (no gzip header). Node's zlib.inflateRawSync handles this.
  const { inflateRawSync } = await import('zlib');
  const out = inflateRawSync(Buffer.from(compBytes));
  return out.toString('utf8');
  // Silence unused imports in some toolchains
  void createGunzip; void pipeline; void Readable;
}

async function downloadHistoricalCsv(): Promise<string> {
  const url = await findHistoricalCsvUrl();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());

  if (url.endsWith('.zip')) {
    return unzipFirstEntry(buf);
  }
  return Buffer.from(buf).toString('utf8');
}

function parseItalianNumber(raw: string): number {
  if (!raw) return NaN;
  const cleaned = raw.replace(/\./g, '').replace(',', '.');
  return Number(cleaned);
}

function parseDdMmYyyy(raw: string): string {
  // Accepts "DD/MM/YYYY"
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Parse the full archive CSV (semicolon-separated, Italian decimals).
 * Header: isincode;marketcode;referencedate;endvaluedate;pricetype;pricevalue;volume;mintoday;maxtoday;
 * One price per ISIN per day; we deduplicate by date keeping the most recent appended row.
 */
function parseArchiveCsv(csv: string): Map<string, PricePoint[]> {
  const byIsin = new Map<string, Map<string, number>>();
  const lines = csv.split(/\r?\n/);
  let started = false;
  let isinIdx = 0; let dateIdx = 2; let priceIdx = 5;
  for (const line of lines) {
    if (!line) continue;
    const cells = line.split(';');
    if (!started) {
      // header
      isinIdx = cells.findIndex((c) => c.trim().toLowerCase() === 'isincode');
      dateIdx = cells.findIndex((c) => c.trim().toLowerCase() === 'referencedate');
      priceIdx = cells.findIndex((c) => c.trim().toLowerCase() === 'pricevalue');
      started = true;
      if (isinIdx < 0 || dateIdx < 0 || priceIdx < 0) {
        // Fall back to defaults if header missing
        isinIdx = 0; dateIdx = 2; priceIdx = 5;
      }
      continue;
    }
    if (cells.length <= Math.max(isinIdx, dateIdx, priceIdx)) continue;
    const isin = cells[isinIdx].trim();
    if (!isin) continue;
    const iso = parseDdMmYyyy(cells[dateIdx].trim());
    if (!iso) continue;
    const price = parseItalianNumber(cells[priceIdx].trim());
    if (!Number.isFinite(price) || price <= 0) continue;
    let series = byIsin.get(isin);
    if (!series) {
      series = new Map();
      byIsin.set(isin, series);
    }
    series.set(iso, price);
  }

  const out = new Map<string, PricePoint[]>();
  for (const [isin, m] of byIsin) {
    const arr: PricePoint[] = Array.from(m.entries())
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => a.date.localeCompare(b.date));
    out.set(isin, arr);
  }
  return out;
}

async function loadBundle(): Promise<BundleState> {
  // If a fresh on-disk cache exists, use it without redownloading.
  await fs.mkdir(cacheDir(), { recursive: true });
  let csvText: string | null = null;
  if (await isCacheFresh()) {
    try {
      csvText = await fs.readFile(csvPath(), 'utf8');
    } catch { /* fall through to download */ }
  }
  if (!csvText) {
    // Try preloaded reference file shipped with the backend (developer seed).
    try {
      const seed = path.resolve('./data/bonds_historical_prices.csv');
      const stat = await fs.stat(seed);
      if (stat.isFile()) csvText = await fs.readFile(seed, 'utf8');
    } catch { /* ignore */ }
  }
  if (!csvText) {
    // eslint-disable-next-line no-console
    console.log('[bondData] downloading historical archive from simpletoolsforinvestors.eu (~45 MB)...');
    csvText = await downloadHistoricalCsv();
    await fs.writeFile(csvPath(), csvText, 'utf8');
    await fs.writeFile(stampPath(), new Date().toISOString(), 'utf8');
  }
  const byIsin = parseArchiveCsv(csvText);
  // eslint-disable-next-line no-console
  console.log(`[bondData] indexed ${byIsin.size} ISINs from archive.`);
  return { parsedAt: Date.now(), byIsin };
}

async function getBundle(): Promise<BundleState> {
  if (inMemoryBundle && Date.now() - inMemoryBundle.parsedAt < STALE_HOURS * 3_600_000) {
    return inMemoryBundle;
  }
  if (!pendingLoad) {
    pendingLoad = loadBundle()
      .then((b) => { inMemoryBundle = b; return b; })
      .finally(() => { pendingLoad = null; });
  }
  return pendingLoad;
}

export class BondDataService {
  constructor(private readonly repo: Repository) {}

  /** Get historical clean prices (% of nominal) for the given ISIN. */
  async getHistoryByIsin(isin: string): Promise<PriceSeries> {
    const cacheKey = `BOND:${isin}`;
    const cached = await this.repo.priceCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - new Date(cached.updatedAt).getTime();
      if (age < STALE_HOURS * 3_600_000 && cached.points.length > 0) return cached;
    }
    try {
      const bundle = await getBundle();
      const points = bundle.byIsin.get(isin) ?? [];
      const series: PriceSeries = {
        symbol: cacheKey,
        currency: 'EUR',
        updatedAt: new Date().toISOString(),
        points,
      };
      if (points.length > 0) await this.repo.priceCache.put(series);
      return series;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[bondData] Failed to load history for ${isin}:`, (err as Error).message);
      return cached ?? { symbol: cacheKey, currency: 'EUR', updatedAt: new Date().toISOString(), points: [] };
    }
  }
}

// ---- Bond list (reference / metadata) ----

interface BondMeta {
  isin: string;
  description: string;
  currency: string;
  market: string;
  redemptionDate?: string;
}

let bondListCache: { loadedAt: number; byIsin: Map<string, BondMeta> } | null = null;
let bondListPending: Promise<Map<string, BondMeta>> | null = null;

async function loadBondList(): Promise<Map<string, BondMeta>> {
  const out = new Map<string, BondMeta>();
  const candidates = [
    path.resolve(config.dataDir, 'bonds_list.csv'),
    path.resolve('./data/bonds_list.csv'),
  ];
  let csv: string | null = null;
  for (const p of candidates) {
    try {
      const stat = await fs.stat(p);
      if (stat.isFile()) {
        csv = await fs.readFile(p, 'utf8');
        break;
      }
    } catch { /* try next */ }
  }
  if (!csv) return out;
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return out;
  const header = lines[0].split(';').map((s) => s.trim().toLowerCase());
  const isinIdx = header.indexOf('isincode');
  const descIdx = header.indexOf('description');
  const curIdx = header.indexOf('currencycode');
  const mktIdx = header.indexOf('marketcode');
  const redIdx = header.indexOf('redemptiondate');
  if (isinIdx < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(';');
    const isin = cells[isinIdx]?.trim();
    if (!isin) continue;
    out.set(isin.toUpperCase(), {
      isin: isin.toUpperCase(),
      description: cells[descIdx]?.trim() ?? '',
      currency: cells[curIdx]?.trim() ?? 'EUR',
      market: cells[mktIdx]?.trim() ?? '',
      redemptionDate: redIdx >= 0 ? cells[redIdx]?.trim() : undefined,
    });
  }
  return out;
}

/** Look up bond metadata for an ISIN in the cached reference list. Returns null if unknown. */
export async function lookupBondByIsin(isin: string): Promise<BondMeta | null> {
  if (!isin) return null;
  const key = isin.trim().toUpperCase();
  if (bondListCache && Date.now() - bondListCache.loadedAt < 24 * 3_600_000) {
    return bondListCache.byIsin.get(key) ?? null;
  }
  if (!bondListPending) {
    bondListPending = loadBondList()
      .then((map) => {
        bondListCache = { loadedAt: Date.now(), byIsin: map };
        return map;
      })
      .finally(() => { bondListPending = null; });
  }
  const map = await bondListPending;
  return map.get(key) ?? null;
}
