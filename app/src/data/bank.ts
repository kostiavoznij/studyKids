import { differenceInCalendarDays, parseISO } from 'date-fns';
import { fmt } from '../lib/dates';
import { money } from '../lib/format';
import { balancesByStudent } from './billing';
import { addMonth } from './taxes';
import type { BankMonth, ID, Lesson, Payment, Student } from './types';

/*
 * Checking a month against the bank statement. Lessons and family balances
 * always follow the records. A difference she explained ("accepted") is added
 * to the month's money as a separate, labelled correction, and stops counting
 * as soon as the records change, so it never hides a new mistake.
 */

export type BankState = 'none' | 'ok' | 'diff' | 'accepted' | 'changed';

export interface BankCheck {
  state: BankState;
  /** statement − records */
  diff: number;
  /** what is added to the records so the month matches the bank — only for an accepted difference */
  correction: number;
  statement?: BankMonth;
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

export function bankCheck(st: BankMonth | undefined, recorded: number): BankCheck {
  if (!st || st.deletedAt) return { state: 'none', diff: 0, correction: 0 };
  const diff = st.amount - recorded;
  if (same(diff, 0)) return { state: 'ok', diff: 0, correction: 0, statement: st };
  if (st.acceptedDiff == null) return { state: 'diff', diff, correction: 0, statement: st };
  if (same(st.acceptedDiff, diff)) return { state: 'accepted', diff, correction: diff, statement: st };
  return { state: 'changed', diff, correction: 0, statement: st };
}

/** Money per month with the accepted differences added. */
export function withCorrections(received: Map<string, number>, bankMonths: Record<ID, BankMonth>): Map<string, number> {
  const out = new Map(received);
  for (const st of Object.values(bankMonths)) {
    const c = bankCheck(st, received.get(st.month) ?? 0).correction;
    if (c) out.set(st.month, (out.get(st.month) ?? 0) + c);
  }
  return out;
}

/** 'yyyy-MM-dd' of the month's last day. */
export function lastDay(month: string): string {
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return `${month}-${days}`;
}

export interface Hint {
  title: string;
  text: string;
  /** a recorded payment to look at */
  paymentId?: ID;
  /** a family whose payment may be missing */
  studentId?: ID;
}

/**
 * Where a difference most likely comes from. More in the bank: a payment dated
 * just outside the month, or one not entered at all. Less in the bank: a payment
 * dated at the month's edge that the bank booked next door, or one entered twice.
 * Anything that equals the difference goes first.
 */
export function discrepancyHints(month: string, diff: number, payments: Payment[], lessons: Lesson[], students: Record<ID, Student>): Hint[] {
  const name = (id: ID) => students[id]?.name ?? '—';
  const fits = (v: number) => (same(v, Math.abs(diff)) ? 'сума збігається з різницею · ' : '');
  const out: (Hint & { score: number })[] = [];
  const live = payments.filter((p) => !p.deletedAt);
  const end = lastDay(month);

  if (diff > 0) {
    const prevEnd = lastDay(addMonth(month, -1));
    const nextStart = `${addMonth(month, 1)}-01`;
    for (const p of live) {
      const before = p.date <= prevEnd && differenceInCalendarDays(parseISO(prevEnd), parseISO(p.date)) <= 2;
      const after = p.date >= nextStart && differenceInCalendarDays(parseISO(p.date), parseISO(nextStart)) <= 2;
      if (!before && !after) continue;
      out.push({
        title: `${name(p.studentId)} · ${money(p.amount)}`,
        text: `${fits(p.amount)}внесено ${fmt(p.date, 'd MMMM')} — якщо банк зарахував її в цьому місяці, змініть дату`,
        paymentId: p.id,
        score: fits(p.amount) ? 3 : 1,
      });
    }
    for (const [id, balance] of balancesByStudent(lessons, live, end)) {
      if (balance > -0.5) continue;
      out.push({
        title: `${name(id)} · не оплачено ${money(-balance)}`,
        text: `${fits(-balance)}на кінець місяця — якщо оплата є у виписці, внесіть її`,
        studentId: id,
        score: fits(-balance) ? 3 : 0.5,
      });
    }
  } else {
    const inside = live.filter((p) => p.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
    for (const p of inside) {
      const edge = differenceInCalendarDays(parseISO(p.date), parseISO(`${month}-01`)) <= 2 || differenceInCalendarDays(parseISO(end), parseISO(p.date)) <= 2;
      if (!edge) continue;
      out.push({
        title: `${name(p.studentId)} · ${money(p.amount)}`,
        text: `${fits(p.amount)}внесено ${fmt(p.date, 'd MMMM')} — якщо банк зарахував її в сусідньому місяці, змініть дату`,
        paymentId: p.id,
        score: fits(p.amount) ? 3 : 1,
      });
    }
    // The same sum from the same family twice within a week.
    inside.forEach((p, i) => {
      const twin = inside.slice(0, i).find((q) => q.studentId === p.studentId && same(q.amount, p.amount) && differenceInCalendarDays(parseISO(p.date), parseISO(q.date)) <= 7);
      if (!twin) return;
      out.push({
        title: `${name(p.studentId)} · двічі по ${money(p.amount)}`,
        text: `${fits(p.amount)}${fmt(twin.date, 'd MMM')} і ${fmt(p.date, 'd MMM')} — чи не внесено одну оплату двічі?`,
        paymentId: p.id,
        score: fits(p.amount) ? 4 : 2,
      });
    });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _, ...h }) => h);
}
