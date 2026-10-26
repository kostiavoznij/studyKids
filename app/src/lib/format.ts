const NNBSP = ' ';
const NBSP = ' ';

const group = (n: number) => Math.round(n).toLocaleString('uk-UA').replace(/\s/g, NNBSP);

/** «2 400 ₴» — every payment is in hryvnias. */
export function money(amount: number): string {
  return `${group(amount)}${NBSP}₴`;
}

/** Short form for tight spots: «2,4 тис» */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}${NBSP}млн`;
  if (abs >= 1_000) return `${trim(n / 1_000)}${NBSP}тис`;
  return String(Math.round(n));
}

/** Tightest form for calendar cells: «1,6к» */
export function tiny(n: number): string {
  return Math.abs(n) >= 1000 ? `${trim(n / 1000)}к` : String(Math.round(n));
}

const trim = (n: number) => (Math.round(n * 10) / 10).toLocaleString('uk-UA');

/** Ukrainian plural: plural(5, ['урок', 'уроки', 'уроків']) → 'уроків' */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const nPlural = (n: number, forms: [string, string, string]) => `${n} ${plural(n, forms)}`;

export const LESSONS: [string, string, string] = ['урок', 'уроки', 'уроків'];
export const TOPICS: [string, string, string] = ['тема', 'теми', 'тем'];
export const STUDENTS: [string, string, string] = ['учень', 'учні', 'учнів'];
export const DAYS: [string, string, string] = ['день', 'дні', 'днів'];
export const TRIALS: [string, string, string] = ['пробний', 'пробні', 'пробних'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const grade1 = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}
