import { createHash, randomUUID } from 'crypto';

export function deterministicId(...parts: (string | number | undefined | null)[]): string {
  const payload = parts.map((p) => (p ?? '').toString()).join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function newId(): string {
  return randomUUID();
}

export function toIsoDate(value: Date | string | number | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function parseNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
