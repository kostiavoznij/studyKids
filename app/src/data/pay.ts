import { dayOf, inRange, type Range } from '../lib/dates';
import { money } from '../lib/format';
import { chargeOf, isTrial } from './money';
import { teacherOf } from './teachers';
import type { ID, Lesson, PayMode, TeacherPay, TeacherPayout } from './types';

/*
 * What the school owes its teachers. A teacher earns for the lessons she taught
 * (and, if her terms say so, for free trial lessons and for late cancellations
 * the family pays for). Her balance is all that was accrued minus all that was
 * paid out. Only the admin sees any of it.
 */

export type PayTerms = Pick<TeacherPay, 'mode' | 'rate' | 'trials' | 'lateCancels'>;

/** No pay counted: the owner herself, or a teacher whose terms aren't set yet. */
export const NO_PAY: PayTerms = { mode: 'none', rate: 0, trials: true, lateCancels: false };

export const termsOf = (rec: Record<ID, TeacherPay>, teacherId: ID): PayTerms => {
  const p = rec[teacherId];
  return p && !p.deletedAt ? p : NO_PAY;
};

export const PAY_MODES: { value: PayMode; label: string; unit: string }[] = [
  { value: 'lesson', label: 'За урок', unit: '₴ за урок' },
  { value: 'hour', label: 'За годину', unit: '₴ за годину' },
  { value: 'percent', label: 'Відсоток', unit: '% від ціни уроку' },
  { value: 'none', label: 'Не рахувати', unit: '' },
];

export function termsText(t: PayTerms): string {
  if (t.mode === 'none' || t.rate <= 0) return 'оплата не рахується';
  if (t.mode === 'percent') return `${t.rate}% від ціни уроку`;
  return `${money(t.rate)} ${t.mode === 'hour' ? 'за годину' : 'за урок'}`;
}

/** What one lesson earns the teacher who taught it. */
export function lessonPay(l: Lesson, t: PayTerms): number {
  if (l.deletedAt || t.mode === 'none' || t.rate <= 0) return 0;
  const happened = l.status === 'done';
  const paidCancel = l.status === 'cancelled' && !!l.cancel?.charged && t.lateCancels;
  if (!happened && !paidCancel) return 0;
  if (isTrial(l) && !t.trials) return 0;
  if (t.mode === 'lesson') return t.rate;
  if (t.mode === 'hour') return Math.round(((t.rate * l.duration) / 60) * 100) / 100;
  const price = l.participants.reduce((sum, p) => sum + chargeOf(l, p), 0);
  return Math.round(price * t.rate) / 100;
}

/** Pay accrued for a teacher's lessons within a period (null — all time), by the lesson's date. */
export function accrued(lessons: Lesson[], teacherId: ID, t: PayTerms, r: Range | null) {
  let amount = 0;
  let count = 0;
  for (const l of lessons) {
    if (teacherOf(l) !== teacherId || (r && !inRange(dayOf(l.start), r))) continue;
    const x = lessonPay(l, t);
    if (x > 0) {
      amount += x;
      count++;
    }
  }
  return { amount, count };
}

/** Payouts to a teacher within a period (null — all time), newest first. */
export function payoutsOf(rec: Record<ID, TeacherPayout>, teacherId: ID, r: Range | null): TeacherPayout[] {
  return Object.values(rec)
    .filter((p) => !p.deletedAt && p.teacherId === teacherId && (!r || inRange(p.date, r)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** What the school still owes her: everything accrued minus everything paid out (negative — paid in advance). */
export function owed(lessons: Lesson[], rec: Record<ID, TeacherPayout>, teacherId: ID, t: PayTerms): number {
  const paid = payoutsOf(rec, teacherId, null).reduce((sum, p) => sum + p.amount, 0);
  return accrued(lessons, teacherId, t, null).amount - paid;
}
