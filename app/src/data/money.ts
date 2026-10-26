import type { Currency, Lesson, Participant, Settings } from './types';

export function toBase(amount: number, currency: Currency, s: Settings): number {
  if (currency === s.baseCurrency) return amount;
  const from = s.rates[currency] ?? 1;
  const to = s.rates[s.baseCurrency] ?? 1;
  return (amount * from) / to;
}

/** What this participant owes for the lesson, in their own currency. */
export function earnedBy(l: Lesson, p: Participant): number {
  if (l.deletedAt) return 0;
  if (l.status === 'done') return p.absent ? 0 : p.price;
  if (l.status === 'cancelled') return l.cancel?.charged ? p.price : 0;
  return 0;
}

export function plannedFor(l: Lesson, p: Participant): number {
  if (l.deletedAt || l.status !== 'planned') return 0;
  return p.price;
}

export function lessonEarned(l: Lesson, s: Settings, studentId?: string): number {
  let sum = 0;
  for (const p of l.participants) {
    if (studentId && p.studentId !== studentId) continue;
    sum += toBase(earnedBy(l, p), p.currency, s);
  }
  return sum;
}

export function lessonPlanned(l: Lesson, s: Settings, studentId?: string): number {
  let sum = 0;
  for (const p of l.participants) {
    if (studentId && p.studentId !== studentId) continue;
    sum += toBase(plannedFor(l, p), p.currency, s);
  }
  return sum;
}

/** Earned but not yet marked as paid. */
export function lessonUnpaid(l: Lesson, s: Settings, studentId?: string): number {
  let sum = 0;
  for (const p of l.participants) {
    if (studentId && p.studentId !== studentId) continue;
    if (!p.paid) sum += toBase(earnedBy(l, p), p.currency, s);
  }
  return sum;
}

/** Sum of a lesson's value whatever its state: earned if it happened, planned otherwise. */
export const lessonValue = (l: Lesson, s: Settings) => lessonEarned(l, s) + lessonPlanned(l, s);
