import { LESSONS, money, nPlural, plural } from '../lib/format';
import { chargeOf, plannedOf } from './money';
import { lessonsOfStudent } from './selectors';
import { useData } from './store';
import type { ID, Lesson, Payment, Settings, Student } from './types';

/**
 * A student's money account. Payments go in, lessons that happened (or late
 * cancellations) draw it down in date order. Positive balance = prepaid lessons
 * left, negative = debt. The same math covers both families that prepay a
 * package and families that pay after every lesson.
 */

export type AccountState = 'ok' | 'low' | 'empty' | 'debt' | 'new';

export interface Account {
  studentId: ID;
  paid: number;
  charged: number;
  balance: number;
  /** whole lessons the balance still covers at the current price */
  lessonsLeft: number;
  debt: number;
  /** charged lessons the payments don't cover */
  unpaidLessons: number;
  state: AccountState;
  /** charged lessons fully covered by payments (oldest first) */
  covered: Set<ID>;
  /** upcoming planned lessons the remaining balance already covers */
  coveredPlanned: Set<ID>;
  lastPayment?: Payment;
}

export function buildAccount(st: Student, lessons: Lesson[], payments: Payment[], s: Settings): Account {
  let paid = 0;
  let lastPayment: Payment | undefined;
  for (const p of payments) {
    if (p.deletedAt || p.studentId !== st.id) continue;
    paid += p.amount;
    if (!lastPayment || p.date >= lastPayment.date) lastPayment = p;
  }

  const covered = new Set<ID>();
  const coveredPlanned = new Set<ID>();
  let charged = 0;
  let unpaidLessons = 0;
  let pool = paid;
  const planned: { id: ID; price: number }[] = [];

  for (const l of lessons) {
    const p = l.participants.find((x) => x.studentId === st.id);
    if (!p) continue;
    const c = chargeOf(l, p);
    if (c > 0) {
      charged += c;
      if (pool >= c - 0.5) {
        covered.add(l.id);
        pool -= c;
      } else {
        unpaidLessons++;
        pool = 0;
      }
    } else {
      const f = plannedOf(l, p);
      if (f > 0) planned.push({ id: l.id, price: f });
    }
  }

  const balance = paid - charged;
  let rest = Math.max(0, balance);
  for (const x of planned) {
    if (rest < x.price - 0.5) break;
    coveredPlanned.add(x.id);
    rest -= x.price;
  }

  const lessonsLeft = st.price > 0 ? Math.floor((Math.max(0, balance) + 0.5) / st.price) : 0;
  const debt = Math.max(0, -balance);
  let state: AccountState;
  if (debt > 0.5) state = 'debt';
  else if (paid === 0 && charged === 0) state = 'new';
  else if (st.billing === 'after') state = 'ok';
  else if (lessonsLeft === 0) state = 'empty';
  else if (lessonsLeft <= s.lowBalanceLessons) state = 'low';
  else state = 'ok';

  return { studentId: st.id, paid, charged, balance, lessonsLeft, debt, unpaidLessons, state, covered, coveredPlanned, lastPayment };
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export function accountLabel(a: Account, st: Student): { text: string; tone: Tone } {
  const rest = a.balance > 0 && st.price > 0 ? a.balance - a.lessonsLeft * st.price : 0;
  const tail = rest > 0.5 ? ` + ${money(rest)}` : '';
  switch (a.state) {
    case 'debt':
      return {
        text: a.unpaidLessons ? `не оплачено ${nPlural(a.unpaidLessons, LESSONS)} · ${money(a.debt)}` : `борг ${money(a.debt)}`,
        tone: 'bad',
      };
    case 'empty':
      return { text: `оплачені уроки закінчились${rest > 0.5 ? ` · залишок ${money(rest)}` : ''}`, tone: 'bad' };
    case 'low':
      return { text: `оплачено ще ${nPlural(a.lessonsLeft, LESSONS)}${tail}`, tone: 'warn' };
    case 'new':
      return { text: st.billing === 'after' ? 'оплата після уроку' : 'оплат ще не було', tone: 'neutral' };
    default:
      return st.billing === 'after' && a.lessonsLeft === 0
        ? { text: 'усе оплачено', tone: 'good' }
        : { text: `оплачено ще ${a.lessonsLeft} ${plural(a.lessonsLeft, LESSONS)}${tail}`, tone: 'good' };
  }
}

/** Accounts of every student, recomputed only when the underlying records change. */
let memo: { args: unknown[]; out: Map<ID, Account> } | null = null;

export function allAccounts(
  students: Record<ID, Student>,
  lessonsRec: Record<ID, Lesson>,
  payments: Record<ID, Payment>,
  s: Settings,
): Map<ID, Account> {
  const args = [students, lessonsRec, payments, s];
  if (memo && memo.args.every((a, i) => a === args[i])) return memo.out;
  const list = Object.values(payments);
  const out = new Map<ID, Account>();
  for (const st of Object.values(students)) {
    if (st.deletedAt) continue;
    out.set(st.id, buildAccount(st, lessonsOfStudent(lessonsRec, st.id), list, s));
  }
  memo = { args, out };
  return out;
}

/** Students the teacher should remind about money, most urgent first. */
export function needsPayment(accounts: Map<ID, Account>, students: Record<ID, Student>) {
  const rank: Record<AccountState, number> = { debt: 0, empty: 1, low: 2, ok: 9, new: 9 };
  return [...accounts.values()]
    .filter((a) => {
      const st = students[a.studentId];
      return st && st.status === 'active' && rank[a.state] < 9;
    })
    .sort((a, b) => rank[a.state] - rank[b.state]);
}

export function useAccounts(): Map<ID, Account> {
  const students = useData((s) => s.students);
  const lessons = useData((s) => s.lessons);
  const payments = useData((s) => s.payments);
  const settings = useData((s) => s.settings);
  return allAccounts(students, lessons, payments, settings);
}
