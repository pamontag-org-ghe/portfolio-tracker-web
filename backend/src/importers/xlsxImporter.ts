import ExcelJS from 'exceljs';
import type { Repository } from '../data/repository.js';
import type {
  AssetCategory, AssetClass, Dividend, InstrumentType, Security, Transaction,
} from '../types.js';
import { deriveAssetClass, deriveInstrumentType } from '../types.js';
import { deterministicId, parseNumber, toIsoDate } from '../utils/ids.js';

export interface ImportSummary {
  securities: { created: number; updated: number; skipped: number };
  transactions: { created: number; updated: number; skipped: number };
  dividends: { created: number; updated: number; skipped: number };
  warnings: string[];
  errors: string[];
}

// Map xlsx "Class"/"Tipo"/"Classe" values to our AssetCategory.
function mapCategory(...values: (string | undefined | null)[]): AssetCategory {
  const v = values.filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
  if (v.includes('crypto') || v.includes('bitcoin') || /\bbtc\b/.test(v) || /\beth\b/.test(v)) return 'Crypto';
  if (v.includes('etf')) return 'ETF';
  if (v.includes('obblig') || v.includes('bond') || /\bo\b/.test(v)) return 'Bond';
  if (v.includes('oro') || v.includes('gold') || v.includes('commod')) return 'Commodities';
  if (v.includes('fund') || v.includes('fondo') || v.includes('mutual')) return 'MutualFund';
  if (v.includes('azion') || v.includes('stock') || /\ba\b/.test(v)) return 'Stock';
  return 'Other';
}

function rowToObject(headers: (string | null)[], row: ExcelJS.Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  headers.forEach((h, idx) => {
    if (!h) return;
    const cell = row.getCell(idx + 1);
    obj[h] = normalizeCellValue(cell.value);
  });
  return obj;
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((rt: { text?: string }) => rt.text ?? '').join('');
    }
    if ('result' in obj) return normalizeCellValue(obj.result);
    if ('text' in obj) return normalizeCellValue(obj.text);
    if ('hyperlink' in obj && 'text' in obj) return normalizeCellValue(obj.text);
  }
  return value;
}

function readSheet(workbook: ExcelJS.Workbook, name: string): Record<string, unknown>[] {
  const ws = workbook.getWorksheet(name);
  if (!ws) return [];
  const headers: (string | null)[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const v = cell.value;
    headers[col - 1] = typeof v === 'string' ? v.trim() : v ? String(v) : null;
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    rows.push(rowToObject(headers, row));
  });
  return rows;
}

function pickString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : String(v);
    const trimmed = s.trim();
    if (trimmed && trimmed !== '[object Object]') return trimmed;
  }
  return undefined;
}

function pickDate(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v) {
      const s = toIsoDate(v as Date | string | number);
      if (s) return s;
    }
  }
  return '';
}

function securityId(ticker: string | undefined, isin: string | undefined, name: string): string {
  return deterministicId('SEC', isin ?? '', ticker ?? '', name);
}

interface AssetClassification {
  assetClass: AssetClass;
  instrumentType: InstrumentType;
  area?: string;
  sector?: string;
  issuer?: string;
}

/**
 * Map the user's "Tipo" (instrument letter) + "Classe" (italian asset class) to our two-axis model.
 *   Tipo:  A=stock direct, O=bond direct, ETF=basket
 *   Classe: Azioni=equities, Obblig=bonds, Oro=gold
 */
function classifyFromStato(tipo?: string, classe?: string, name?: string): AssetClassification {
  const t = (tipo ?? '').toString().trim().toUpperCase();
  const c = (classe ?? '').toString().trim().toLowerCase();
  let assetClass: AssetClass = 'Other';
  if (c.startsWith('azion')) assetClass = 'Stock';
  else if (c.startsWith('obblig')) assetClass = 'Bond';
  else if (c === 'oro' || /gold|oro/.test((name ?? '').toLowerCase())) assetClass = 'Gold';

  let instrumentType: InstrumentType = 'Other';
  if (t === 'A') instrumentType = 'Stock';
  else if (t === 'O') instrumentType = 'Bond';
  else if (t === 'ETF') instrumentType = 'ETF';
  else if (t === 'FONDO' || t === 'FUND') instrumentType = 'MutualFund';

  return { assetClass, instrumentType };
}

function classifyFromHints(category: AssetCategory, classValue: string | undefined, name: string | undefined): AssetClassification {
  const lname = (name ?? '').toLowerCase();
  const cls = (classValue ?? '').toLowerCase();
  let assetClass: AssetClass = 'Other';
  let instrumentType: InstrumentType = 'Other';

  if (cls === 'a' || category === 'Stock') instrumentType = 'Stock';
  else if (cls === 'o' || category === 'Bond') instrumentType = 'Bond';
  else if (cls === 'etf' || category === 'ETF' || category === 'Commodities') instrumentType = 'ETF';
  else if (category === 'MutualFund') instrumentType = 'MutualFund';
  else if (category === 'Crypto' || /(bitcoin|ethereum|crypto|\bbtc\b|\beth\b)/i.test(lname)) instrumentType = 'Crypto';

  if (/(gold|oro|bullion|silver|argento|platinum)/.test(lname) || category === 'Commodities') {
    assetClass = 'Gold';
  } else if (category === 'Crypto' || instrumentType === 'Crypto') {
    assetClass = 'Crypto';
  } else if (
    /(bond|obblig|treasury|aggregate|govern|corporate|bund|btp|gilt|oat|cedola|euro corp|sovereign)/i.test(lname) ||
    instrumentType === 'Bond'
  ) {
    assetClass = 'Bond';
  } else if (instrumentType === 'Stock' || instrumentType === 'ETF' || instrumentType === 'MutualFund') {
    assetClass = 'Stock';
  }

  return { assetClass, instrumentType };
}

function lookupClassification(
  map: Map<string, AssetClassification>,
  isin?: string,
  ticker?: string,
  name?: string
): AssetClassification | undefined {
  if (isin && map.has(`I:${isin}`)) return map.get(`I:${isin}`);
  if (ticker && map.has(`T:${ticker}`)) return map.get(`T:${ticker}`);
  if (name && map.has(`N:${name.toLowerCase()}`)) return map.get(`N:${name.toLowerCase()}`);
  return undefined;
}

/** Build classification map from Stato patrimoniale sheet, keyed by ISIN / Ticker / lowercase name. */
function readStatoPatrimoniale(wb: ExcelJS.Workbook): Map<string, AssetClassification> {
  const out = new Map<string, AssetClassification>();
  const rows = readSheet(wb, 'Stato patrimoniale');
  for (const row of rows) {
    const tipo = pickString(row, 'Tipo');
    const classe = pickString(row, 'Classe');
    const isin = pickString(row, 'ISIN');
    const ticker = pickString(row, 'Ticker');
    const name = pickString(row, 'Nome', 'Name');
    if (!tipo && !classe) continue;
    const cl: AssetClassification = {
      ...classifyFromStato(tipo, classe, name),
      area: pickString(row, 'Area'),
      sector: pickString(row, 'Settore'),
      issuer: pickString(row, 'Emittente'),
    };
    if (isin) out.set(`I:${isin}`, cl);
    if (ticker) out.set(`T:${ticker}`, cl);
    if (name) out.set(`N:${name.toLowerCase()}`, cl);
  }
  return out;
}

/**
 * Normalise the ("shares", "value") pair for a bond row. The user's xlsx is inconsistent:
 * the Buy sheet stores value as actual cash (nominal × clean_price / 100) but the Sell
 * sheet sometimes stores nominal × clean_price (no /100). Detect by ratio and correct.
 */
function normaliseBondAmount(shares: number, value: number, category: AssetCategory): number {
  if (category !== 'Bond' || shares <= 0 || value <= 0) return value;
  const ratio = value / shares;
  // Clean bond prices are between roughly 30 and 200% of nominal. If ratio > 10 the
  // value is clearly missing the /100 divisor — correct it.
  if (ratio > 10) return value / 100;
  return value;
}

function priceConventionFor(category: AssetCategory): 'unit' | 'percent' {
  return category === 'Bond' ? 'percent' : 'unit';
}

/**
 * For a given transaction, compute the per-unit price in the security currency.
 * - For stocks/ETFs/etc.: total / shares (the unit price).
 * - For bonds: total / nominal × 100 (the clean price as % of nominal).
 */
function unitPriceFor(grossAmount: number, shares: number, convention: 'unit' | 'percent'): number {
  if (shares <= 0) return 0;
  if (convention === 'percent') return (grossAmount / shares) * 100;
  return grossAmount / shares;
}

export async function importWorkbook(buffer: Buffer, userId: string, repo: Repository): Promise<ImportSummary> {
  return repo.transaction(() => importWorkbookInner(buffer, userId, repo));
}

async function importWorkbookInner(buffer: Buffer, userId: string, repo: Repository): Promise<ImportSummary> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS accepts an ArrayBuffer; convert the Node Buffer's underlying buffer view.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await wb.xlsx.load(ab);

  const summary: ImportSummary = {
    securities: { created: 0, updated: 0, skipped: 0 },
    transactions: { created: 0, updated: 0, skipped: 0 },
    dividends: { created: 0, updated: 0, skipped: 0 },
    warnings: [],
    errors: [],
  };

  // 0. Classification map from the master "Stato patrimoniale" sheet (Tipo + Classe).
  const classificationMap = readStatoPatrimoniale(wb);

  // 1. Securities master
  const securitiesRows = readSheet(wb, 'Securities');
  const nameToSecurityId = new Map<string, string>();
  const isinToSecurityId = new Map<string, string>();

  for (const row of securitiesRows) {
    const ticker = pickString(row, 'Ticker Symbol', 'Ticker');
    const isin = pickString(row, 'ISIN');
    const name = pickString(row, 'Security Name', 'Name');
    const currency = pickString(row, 'Currency', 'Valuta') ?? 'EUR';
    if (!name) {
      summary.warnings.push(`Securities sheet: skipped row without name (ticker=${ticker ?? ''})`);
      summary.securities.skipped++;
      continue;
    }
    const id = securityId(ticker, isin, name);
    const existing = await repo.securities.findById(id);
    const category = mapCategory(pickString(row, 'Class'));
    const classification =
      lookupClassification(classificationMap, isin, ticker, name)
      ?? classifyFromHints(category, undefined, name);
    const security: Security = {
      id,
      ticker,
      isin,
      name,
      category,
      currency,
      assetClass: classification.assetClass,
      instrumentType: classification.instrumentType,
      area: classification.area,
      sector: classification.sector,
      issuer: classification.issuer,
      priceConvention: priceConventionFor(category),
    };
    await repo.securities.upsert(security);
    if (existing) summary.securities.updated++; else summary.securities.created++;
    nameToSecurityId.set(name.toLowerCase(), id);
    if (isin) isinToSecurityId.set(isin, id);
  }

  // Helper: find/create a security on the fly when transaction sheet references something not in Securities.
  async function resolveSecurity(opts: {
    ticker?: string; isin?: string; name?: string; classValue?: string; currency?: string;
  }): Promise<Security | null> {
    const { ticker, isin, name, classValue, currency } = opts;
    if (!name && !isin && !ticker) return null;
    const newCategory = mapCategory(classValue);
    const lookedUp = lookupClassification(classificationMap, isin, ticker, name);
    const classification = lookedUp ?? classifyFromHints(newCategory, classValue, name);

    let existing: Security | null = null;
    if (name) {
      const id = nameToSecurityId.get(name.toLowerCase());
      if (id) existing = await repo.securities.findById(id);
    }
    if (!existing && isin) existing = await repo.securities.findByIsin(isin);
    if (!existing && ticker) existing = await repo.securities.findByTicker(ticker);

    if (existing) {
      const patch: Partial<Security> = {};
      if (existing.category === 'Other' && newCategory !== 'Other') {
        patch.category = newCategory;
        patch.priceConvention = priceConventionFor(newCategory);
      }
      if (!existing.assetClass || existing.assetClass === 'Other') patch.assetClass = classification.assetClass;
      if (!existing.instrumentType || existing.instrumentType === 'Other') patch.instrumentType = classification.instrumentType;
      if (!existing.priceConvention) patch.priceConvention = priceConventionFor(existing.category);
      if (Object.keys(patch).length > 0) {
        existing = { ...existing, ...patch };
        await repo.securities.upsert(existing);
      }
      return existing;
    }

    const id = securityId(ticker, isin, name ?? ticker ?? isin ?? 'Unknown');
    const security: Security = {
      id,
      ticker,
      isin,
      name: name ?? ticker ?? isin ?? 'Unknown',
      category: newCategory,
      currency: currency ?? 'EUR',
      assetClass: classification.assetClass,
      instrumentType: classification.instrumentType,
      area: classification.area,
      sector: classification.sector,
      issuer: classification.issuer,
      priceConvention: priceConventionFor(newCategory),
    };
    await repo.securities.upsert(security);
    summary.securities.created++;
    if (name) nameToSecurityId.set(name.toLowerCase(), id);
    if (isin) isinToSecurityId.set(isin, id);
    return security;
  }

  // 2. Buy transactions
  const buyRows = readSheet(wb, 'Transactions_Buy');
  // Track duplicate-row slots so two visually identical rows aren't merged into one.
  const txSlots = new Map<string, number>();
  for (const row of buyRows) {
    const ticker = pickString(row, 'Ticker Symbol');
    const isin = pickString(row, 'ISIN');
    const name = pickString(row, 'Security Name');
    const classValue = pickString(row, 'Class');
    const currency = pickString(row, 'Currency Gross Amount', 'Currency') ?? 'EUR';
    const shares = parseNumber(row['Shares']);
    const rawValue = parseNumber(row['Value']);
    const exchangeRate = parseNumber(row['Exchange rate'], 1);
    const fees = parseNumber(row['fees']);
    const taxes = parseNumber(row['taxes']);
    const date = pickDate(row, 'Date');

    if (!date || shares <= 0 || rawValue <= 0) {
      summary.warnings.push(`Buy: skipped incomplete row (ticker=${ticker ?? ''}, isin=${isin ?? ''}, date=${date})`);
      summary.transactions.skipped++;
      continue;
    }

    const sec = await resolveSecurity({ ticker, isin, name, classValue, currency });
    if (!sec) {
      summary.warnings.push('Buy: cannot resolve security for row');
      summary.transactions.skipped++;
      continue;
    }

    const value = normaliseBondAmount(shares, rawValue, sec.category);
    const slotKey = `${sec.id}|BUY|${date}|${shares}|${value}`;
    const slot = txSlots.get(slotKey) ?? 0;
    txSlots.set(slotKey, slot + 1);
    const id = deterministicId('TX', userId, sec.id, 'BUY', date, shares, value, slot);
    const conv = sec.priceConvention ?? priceConventionFor(sec.category);
    const tx: Transaction = {
      id,
      userId,
      securityId: sec.id,
      ticker: sec.ticker,
      isin: sec.isin,
      securityName: sec.name,
      category: sec.category,
      type: 'BUY',
      shares,
      grossAmount: value,
      pricePerShare: unitPriceFor(value, shares, conv),
      exchangeRate,
      fees,
      taxes,
      date,
      broker: pickString(row, 'Securities account'),
    };
    const existing = await repo.transactions.findById(userId, id);
    await repo.transactions.upsert(tx);
    if (existing) summary.transactions.updated++; else summary.transactions.created++;
  }

  // 3. Sell transactions
  const sellRows = readSheet(wb, 'Transaction_Sell');
  for (const row of sellRows) {
    const ticker = pickString(row, 'Ticker Symbol');
    const isin = pickString(row, 'ISIN');
    const name = pickString(row, 'Security Name');
    const classValue = pickString(row, 'Class');
    const currency = pickString(row, 'Currency Gross Amount', 'Currency') ?? 'EUR';
    const shares = parseNumber(row['Shares']);
    const rawValue = parseNumber(row['Value']);
    if (!name || shares <= 0 || rawValue <= 0) {
      // Sell sheet has many id-only stub rows; skip silently unless name present.
      if (name) summary.transactions.skipped++;
      continue;
    }
    const date = pickDate(row, 'Date');
    if (!date) {
      summary.warnings.push(`Sell: skipped row without date (${name})`);
      summary.transactions.skipped++;
      continue;
    }
    const exchangeRate = parseNumber(row['Exchange rate'], 1);
    const fees = parseNumber(row['fees']);
    const taxes = parseNumber(row['taxes']);
    const sec = await resolveSecurity({ ticker, isin, name, classValue, currency });
    if (!sec) { summary.transactions.skipped++; continue; }

    const value = normaliseBondAmount(shares, rawValue, sec.category);
    const slotKey = `${sec.id}|SELL|${date}|${shares}|${value}`;
    const slot = txSlots.get(slotKey) ?? 0;
    txSlots.set(slotKey, slot + 1);
    const id = deterministicId('TX', userId, sec.id, 'SELL', date, shares, value, slot);
    const conv = sec.priceConvention ?? priceConventionFor(sec.category);
    const tx: Transaction = {
      id,
      userId,
      securityId: sec.id,
      ticker: sec.ticker,
      isin: sec.isin,
      securityName: sec.name,
      category: sec.category,
      type: 'SELL',
      shares,
      grossAmount: value,
      pricePerShare: unitPriceFor(value, shares, conv),
      exchangeRate,
      fees,
      taxes,
      date,
      broker: pickString(row, 'Securities account'),
    };
    const existing = await repo.transactions.findById(userId, id);
    await repo.transactions.upsert(tx);
    if (existing) summary.transactions.updated++; else summary.transactions.created++;
  }

  // 4. Dividends
  const dividendRows = readSheet(wb, 'Dividends');
  for (const row of dividendRows) {
    const name = pickString(row, 'Security Name');
    const date = pickDate(row, 'Date');
    const amount = parseNumber(row['Value']);
    // Source spreadsheet stores withholding tax as a *negative* number
    // (e.g. -0.0988). We normalise to a positive amount internally so that
    // dividendsGross = dividendsNet + dividendsTaxes always holds.
    const taxes = Math.abs(parseNumber(row['taxes']));
    if (!name || !date || amount === 0) { summary.dividends.skipped++; continue; }
    const sec = await resolveSecurity({ name, classValue: pickString(row, 'Class') });
    if (!sec) { summary.dividends.skipped++; continue; }
    const id = deterministicId('DV', userId, sec.id, date, amount, taxes);
    const dividend: Dividend = {
      id, userId,
      securityId: sec.id,
      securityName: sec.name,
      category: sec.category,
      amount, taxes, date,
    };
    const existing = await (repo.dividends.listByUser(userId).then((all) => all.find((d) => d.id === id)));
    await repo.dividends.upsert(dividend);
    if (existing) summary.dividends.updated++; else summary.dividends.created++;
  }

  return summary;
}
