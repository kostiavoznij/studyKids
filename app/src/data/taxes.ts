import { fmt, todayKey, type Range } from '../lib/dates';
import type { ID, Payment, TaxEvery, TaxKind, TaxPayment, TaxPlan, TaxRule } from './types';

/*
 * Taxes of a sole proprietor (ФОП, 3rd group). Money counts the way the tax
 * office counts it: by the day it reached the account. Each tax is paid either
 * monthly or quarterly. She can switch, but only from the start of a quarter, so
 * months and quarters never overlap and every recorded payment keeps fitting.
 *
 * Months are 'yyyy-MM'; a period is a month or a quarter 'yyyy-Qn'.
 */

export const TAX_PLAN_ID = 'main';

export const TAX_KINDS: { value: TaxKind; label: string; long: string }[] = [
  { value: 'tax', label: 'Податок', long: 'Єдиний податок + військовий збір' },
  { value: 'esv', label: 'ЄСВ', long: 'Внесок на стаж' },
];

export const taxLabel = (kind: TaxKind) => (kind === 'esv' ? 'ЄСВ' : 'Податок');

export const EVERY: { value: TaxEvery; label: string }[] = [
  { value: 'month', label: 'Щомісяця' },
  { value: 'quarter', label: 'Щокварталу' },
];

/* ---------- months and periods ---------- */

export const monthOf = (day: string) => day.slice(0, 7);
export const thisMonth = () => monthOf(todayKey());

export function addMonth(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export const isQuarter = (p: string) => p.includes('Q');
export const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;

export function firstMonth(p: string): string {
  if (!isQuarter(p)) return p;
  return `${p.slice(0, 4)}-${String((Number(p.slice(6)) - 1) * 3 + 1).padStart(2, '0')}`;
}

export const lastMonth = (p: string) => (isQuarter(p) ? addMonth(firstMonth(p), 2) : p);
export const quarterStart = (month: string) => firstMonth(quarterOf(month));
export const monthsOf = (p: string) => (isQuarter(p) ? [0, 1, 2].map((i) => addMonth(firstMonth(p), i)) : [p]);
export const daysOf = (from: string, to = from): Range => ({ from: `${firstMonth(from)}-01`, to: `${lastMonth(to)}-31` });

const ROMAN = ['I', 'II', 'III', 'IV'];

/** «жовтень», «IV кв.» — with the year when it isn't this one. */
export function periodLabel(p: string, withYear = p.slice(0, 4) !== thisMonth().slice(0, 4)): string {
  const year = withYear ? ` ${p.slice(0, 4)}` : '';
  if (isQuarter(p)) return `${ROMAN[Number(p.slice(6)) - 1]} кв.${year}`;
  return fmt(`${p}-01`, 'LLLL') + year;
}

/** «з липня 2026», «з III кв. 2026» */
export const sinceLabel = (p: string) => (isQuarter(p) ? `з ${periodLabel(p, true)}` : `з ${fmt(`${p}-01`, 'MMMM yyyy')}`);

/* ---------- the plan ---------- */

export function defaultPlan(start: string): TaxPlan {
  return {
    id: TAX_PLAN_ID,
    start,
    rules: { tax: [{ from: '', every: 'month' }], esv: [{ from: '', every: 'quarter' }] },
    createdAt: 0,
    updatedAt: 0,
  };
}

/** The saved plan, or the usual one starting with the first month money came in. */
export function planOf(plans: Record<ID, TaxPlan>, payments: Payment[]): { plan: TaxPlan; saved: boolean } {
  const saved = plans[TAX_PLAN_ID];
  if (saved && !saved.deletedAt) return { plan: saved, saved: true };
  let first = thisMonth();
  for (const p of payments) if (!p.deletedAt && !p.opening && monthOf(p.date) < first) first = monthOf(p.date);
  return { plan: defaultPlan(first), saved: false };
}

/** How often the tax is paid in a month. Rules only ever start with a quarter, so all three months agree. */
export function everyAt(plan: TaxPlan, kind: TaxKind, month: string): TaxEvery {
  const q = quarterStart(month);
  let every: TaxEvery = plan.rules[kind][0]?.every ?? 'month';
  for (const r of plan.rules[kind]) if (!r.from || quarterStart(r.from) <= q) every = r.every;
  return every;
}

/** The period a month belongs to. */
export const periodOf = (plan: TaxPlan, kind: TaxKind, month: string) =>
  everyAt(plan, kind, month) === 'quarter' ? quarterOf(month) : month;

/** A recorded period matches the plan — always true unless two devices changed things at once. */
export const fits = (plan: TaxPlan, kind: TaxKind, p: string) => periodOf(plan, kind, firstMonth(p)) === p;

export const nextPeriod = (plan: TaxPlan, kind: TaxKind, p: string) => periodOf(plan, kind, addMonth(lastMonth(p), 1));
export const prevPeriod = (plan: TaxPlan, kind: TaxKind, p: string) => periodOf(plan, kind, addMonth(firstMonth(p), -1));

/** Periods that touch the months from..to, oldest first. */
export function periodsIn(plan: TaxPlan, kind: TaxKind, from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) {
    const p = periodOf(plan, kind, m);
    if (out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

/** Rules after switching to `every` from the quarter starting with `from` ('' — from the very beginning). */
export function withRule(plan: TaxPlan, kind: TaxKind, every: TaxEvery, from: string): TaxRule[] {
  const kept = from ? plan.rules[kind].filter((r) => r.from < from) : [];
  const out: TaxRule[] = [];
  for (const r of [...kept, { from, every }]) {
    if (out.length && out[out.length - 1].every === r.every) continue;
    out.push(out.length ? r : { ...r, from: '' });
  }
  return out;
}

export interface ChangeOption {
  from: string;
  label: string;
}

/**
 * Where a switch to `every` may start. A start is refused when a payment from
 * then on was recorded for a period the new rule doesn't have (a quarter paid
 * as a whole can't turn into three months, and the other way round).
 */
export function changeOptions(plan: TaxPlan, kind: TaxKind, every: TaxEvery, taxes: TaxPayment[], today = thisMonth()) {
  const mine = taxes.filter((t) => !t.deletedAt && t.kind === kind);
  const conflicts = (from: string) => {
    const next = { ...plan, rules: { ...plan.rules, [kind]: withRule(plan, kind, every, from) } };
    return mine.filter((t) => (!from || lastMonth(t.period) >= from) && !fits(next, kind, t.period));
  };

  const now = quarterStart(today);
  const candidates = [''];
  for (let q = addMonth(quarterStart(plan.start), 3); q <= addMonth(now, 6); q = addMonth(q, 3)) candidates.push(q);

  const first = candidates.findIndex((c) => conflicts(c).length === 0);
  const options: ChangeOption[] = [];
  candidates.forEach((c, i) => {
    if (i < first || (i > first && c < now)) return;
    options.push({ from: c, label: c ? `з ${periodLabel(quarterOf(c), true)}` : 'з самого початку' });
  });

  // Explain why the earlier quarters are not offered.
  let blockedBy: TaxPayment | undefined;
  if (first > 0) {
    for (const t of conflicts(candidates[first - 1])) if (!blockedBy || t.period > blockedBy.period) blockedBy = t;
  }
  return { options, blockedBy };
}

/** Rules that start after this quarter, i.e. a change she has planned ahead. */
export const plannedRule = (plan: TaxPlan, kind: TaxKind, today = thisMonth()) =>
  plan.rules[kind].find((r) => r.from > quarterStart(today));

/* ---------- money ---------- */

export function receivedByMonth(payments: Payment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of payments) {
    if (p.deletedAt || p.opening) continue;
    const m = monthOf(p.date);
    out.set(m, (out.get(m) ?? 0) + p.amount);
  }
  return out;
}

/**
 * Taxes that belong to each month. A quarterly payment is spread over its three
 * months: ЄСВ evenly (it is a fixed sum per month), the tax in proportion to the
 * money that came in, since it is a share of income.
 */
export function taxesByMonth(taxes: TaxPayment[], received: Map<string, number>): Map<string, Record<TaxKind, number>> {
  const out = new Map<string, Record<TaxKind, number>>();
  const add = (m: string, kind: TaxKind, v: number) => {
    const row = out.get(m) ?? { tax: 0, esv: 0 };
    row[kind] += v;
    out.set(m, row);
  };
  for (const t of taxes) {
    if (t.deletedAt) continue;
    const months = monthsOf(t.period);
    const income = months.map((m) => received.get(m) ?? 0);
    const total = income.reduce((a, b) => a + b, 0);
    months.forEach((m, i) => add(m, t.kind, t.kind === 'tax' && total > 0 ? (t.amount * income[i]) / total : t.amount / months.length));
  }
  return out;
}

export interface MoneyMonth {
  month: string;
  received: number;
  tax: number;
  esv: number;
  net: number;
}

export function moneyMonths(from: string, to: string, received: Map<string, number>, taxes: Map<string, Record<TaxKind, number>>): MoneyMonth[] {
  const out: MoneyMonth[] = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) {
    const r = received.get(m) ?? 0;
    const t = taxes.get(m) ?? { tax: 0, esv: 0 };
    out.push({ month: m, received: r, tax: t.tax, esv: t.esv, net: r - t.tax - t.esv });
  }
  return out;
}

/* ---------- what is still to be entered ---------- */

export interface TaxDue {
  kind: TaxKind;
  period: string;
}

/** «податок за жовтень, ЄСВ за III кв.» */
export const dueText = (list: TaxDue[]) =>
  list.map((d) => `${d.kind === 'esv' ? 'ЄСВ' : 'податок'} за ${periodLabel(d.period)}`).join(', ');

/** Months a kind of tax was recorded for. */
function paidMonths(taxes: TaxPayment[], kind: TaxKind): Set<string> {
  const out = new Set<string>();
  for (const t of taxes) if (!t.deletedAt && t.kind === kind) monthsOf(t.period).forEach((m) => out.add(m));
  return out;
}

export const isPaid = (taxes: TaxPayment[], kind: TaxKind, p: string) => {
  const paid = paidMonths(taxes, kind);
  return monthsOf(p).some((m) => paid.has(m));
};

/**
 * Periods since plan.start that are over and have nothing recorded. The tax is
 * only asked for when money came in; ЄСВ is due every period regardless.
 */
export function missingTaxes(plan: TaxPlan, taxes: TaxPayment[], received: Map<string, number>, today = thisMonth()): TaxDue[] {
  const out: TaxDue[] = [];
  const last = addMonth(today, -1);
  if (plan.start > last) return out;
  for (const { value: kind } of TAX_KINDS) {
    const paid = paidMonths(taxes, kind);
    for (const p of periodsIn(plan, kind, plan.start, last)) {
      const months = monthsOf(p);
      if (lastMonth(p) > last || months.some((m) => paid.has(m))) continue;
      if (kind === 'tax' && !months.some((m) => (received.get(m) ?? 0) > 0)) continue;
      out.push({ kind, period: p });
    }
  }
  return out;
}
