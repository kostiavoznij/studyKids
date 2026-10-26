import { uid } from '../lib/format';
import type { Group, ID, Lesson, Payment, Student } from './types';

/**
 * Version 1 kept a currency per student and a «paid» flag per lesson. Version 2
 * is hryvnia-only with a payments ledger: every lesson marked as paid becomes a
 * payment of its price on that day, so balances come out the same.
 */
export function migrateV1(old: any) {
  const rates: Record<string, number> = old.settings?.rates ?? {};
  const toUah = (amount: number, currency?: string) =>
    !currency || currency === 'UAH' ? amount : Math.round(amount * (rates[currency] ?? 1));

  const students: Record<ID, Student> = {};
  for (const [id, s] of Object.entries<any>(old.students ?? {})) {
    const { currency, ...rest } = s;
    students[id] = { ...rest, price: toUah(s.price, currency), billing: 'after' };
  }

  const groups: Record<ID, Group> = {};
  for (const [id, g] of Object.entries<any>(old.groups ?? {})) {
    const { currency, ...rest } = g;
    groups[id] = { ...rest, price: toUah(g.price, currency) };
  }

  const lessons: Record<ID, Lesson> = {};
  const payments: Record<ID, Payment> = {};
  for (const [id, l] of Object.entries<any>(old.lessons ?? {})) {
    const charged = !l.deletedAt && (l.status === 'done' || (l.status === 'cancelled' && l.cancel?.charged));
    const participants = (l.participants ?? []).map((p: any) => {
      const price = toUah(p.price, p.currency);
      if (charged && p.paid && !(l.status === 'done' && p.absent)) {
        const t = l.updatedAt ?? Date.now();
        const pay: Payment = { id: uid(), studentId: p.studentId, date: l.start.slice(0, 10), amount: price, lessons: 1, note: '', createdAt: t, updatedAt: t };
        payments[pay.id] = pay;
      }
      const { currency, paid, ...rest } = p;
      return { ...rest, price };
    });
    lessons[id] = { ...l, participants };
  }

  const { baseCurrency, rates: _r, ...settings } = old.settings ?? {};
  return { ...old, students, groups, lessons, payments, settings, seeded: old.seeded ?? 'clean' };
}
