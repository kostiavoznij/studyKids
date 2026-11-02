import { LESSONS, money, nPlural, plural } from '../lib/format';
import { chargeOf, plannedOf } from './money';
import { lessonsOfStudent } from './selectors';
import { useData } from './store';
import type { Group, ID, Lesson, Payment, Settings, Student } from './types';

/**
 * A student's money account. Payments go in, lessons that happened (or late
 * cancellations) draw it down in date order. Positive balance = prepaid lessons
 * left, negative = debt. The same math covers both families that prepay a
 * package and families that pay after every lesson.
 *
 * Money for individual lessons and money for each group are kept apart (pots):
 * a family pays for group lessons at the group's price, and that money never
 * pays for a dearer individual lesson, nor the other way round.
 */

export type AccountState = 'ok' | 'low' | 'empty' | 'debt' | 'new';

/** Money for one kind of lessons: the individual ones, or one group's. */
export interface Pot {
  /** missing — individual lessons */
  groupId?: ID;
  /** the group's name; '' for individual lessons */
  name: string;
  /** what one lesson here costs now */
  price: number;
  paid: number;
  charged: number;
  balance: number;
  /** whole lessons the balance still covers at the current price */
  lessonsLeft: number;
  debt: number;
  /** charged lessons the payments don't cover */
  unpaidLessons: number;
  state: AccountState;
}

export interface Account {
  studentId: ID;
  /** individual lessons first, then the groups; only pots that matter now */
  pots: Pot[];
  paid: number;
  charged: number;
  balance: number;
  /** all pots together */
  lessonsLeft: number;
  debt: number;
  unpaidLessons: number;
  /** the most urgent state of the pots */
  state: AccountState;
  /** charged lessons fully covered by payments (oldest first) */
  covered: Set<ID>;
  /** upcoming planned lessons the remaining balance already covers */
  coveredPlanned: Set<ID>;
  lastPayment?: Payment;
}

const URGENCY: Record<AccountState, number> = { debt: 0, empty: 1, low: 2, ok: 3, new: 4 };

interface Tally {
  groupId?: ID;
  paid: number;
  charged: number;
  unpaidLessons: number;
  pool: number;
  planned: { id: ID; price: number }[];
  lastPrice: number;
}

export function buildAccount(st: Student, lessons: Lesson[], payments: Payment[], s: Settings, groups: Record<ID, Group> = {}): Account {
  const tallies = new Map<string, Tally>();
  const tally = (groupId?: ID) => {
    let t = tallies.get(groupId ?? '');
    if (!t) {
      t = { groupId, paid: 0, charged: 0, unpaidLessons: 0, pool: 0, planned: [], lastPrice: 0 };
      tallies.set(groupId ?? '', t);
    }
    return t;
  };
  tally();

  let lastPayment: Payment | undefined;
  for (const p of payments) {
    if (p.deletedAt || p.studentId !== st.id) continue;
    const t = tally(p.groupId);
    t.paid += p.amount;
    t.pool += p.amount;
    if (!lastPayment || p.date >= lastPayment.date) lastPayment = p;
  }

  const covered = new Set<ID>();
  const coveredPlanned = new Set<ID>();
  for (const l of lessons) {
    const p = l.participants.find((x) => x.studentId === st.id);
    if (!p) continue;
    const t = tally(l.groupId);
    if (p.price > 0) t.lastPrice = p.price;
    const c = chargeOf(l, p);
    if (c > 0) {
      t.charged += c;
      if (t.pool >= c - 0.5) {
        covered.add(l.id);
        t.pool -= c;
      } else {
        t.unpaidLessons++;
        t.pool = 0;
      }
    } else {
      const f = plannedOf(l, p);
      if (f > 0) t.planned.push({ id: l.id, price: f });
    }
  }

  const all = [...tallies.values()].map((t) => {
    const g = t.groupId ? groups[t.groupId] : undefined;
    const price = t.groupId ? g?.price || t.lastPrice || st.price : st.price;
    const balance = t.paid - t.charged;
    let rest = Math.max(0, balance);
    for (const x of t.planned) {
      if (rest < x.price - 0.5) break;
      coveredPlanned.add(x.id);
      rest -= x.price;
    }
    const lessonsLeft = price > 0 ? Math.floor((Math.max(0, balance) + 0.5) / price) : 0;
    const debt = Math.max(0, -balance);
    let state: AccountState;
    if (debt > 0.5) state = 'debt';
    else if (t.paid === 0 && t.charged === 0) state = 'new';
    else if (st.billing === 'after') state = 'ok';
    else if (lessonsLeft === 0) state = 'empty';
    else if (lessonsLeft <= s.lowBalanceLessons) state = 'low';
    else state = 'ok';
    const busy = t.planned.length > 0 || Math.abs(balance) > 0.5;
    const pot: Pot = { groupId: t.groupId, name: g?.name ?? '', price, paid: t.paid, charged: t.charged, balance, lessonsLeft, debt, unpaidLessons: t.unpaidLessons, state };
    return { pot, busy };
  });

  // A group matters while it has lessons ahead or money left either way; the
  // individual lessons — unless the student only comes to groups now.
  const groupPots = all.filter((x) => x.pot.groupId && x.busy).map((x) => x.pot);
  groupPots.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const own = all[0];
  const pots = !groupPots.length || own.busy || st.schedule.length > 0 ? [own.pot, ...groupPots] : groupPots;

  // Once the family has paid or had lessons anywhere, a pot with nothing paid yet is simply unpaid.
  const fresh = pots.every((x) => x.state === 'new');
  if (!fresh) for (const x of pots) if (x.state === 'new') x.state = st.billing === 'after' ? 'ok' : 'empty';
  const state = fresh ? 'new' : pots.reduce<AccountState>((a, x) => (URGENCY[x.state] < URGENCY[a] ? x.state : a), 'ok');

  const sum = (f: (x: Pot) => number) => pots.reduce((a, x) => a + f(x), 0);
  return {
    studentId: st.id,
    pots,
    paid: sum((x) => x.paid),
    charged: sum((x) => x.charged),
    balance: sum((x) => x.balance),
    lessonsLeft: sum((x) => x.lessonsLeft),
    debt: sum((x) => x.debt),
    unpaidLessons: sum((x) => x.unpaidLessons),
    state,
    covered,
    coveredPlanned,
    lastPayment,
  };
}

/**
 * Money held in advance and money owed across all families at the end of a day.
 * Between two days, payments − charged lessons = Δprepaid − Δowed, which is
 * exactly why money in the bank differs from money earned by lessons.
 */
export function balancesAt(lessons: Lesson[], payments: Payment[], day: string): { prepaid: number; owed: number } {
  let prepaid = 0;
  let owed = 0;
  for (const { balance } of potBalances(lessons, payments, day)) {
    if (balance > 0) prepaid += balance;
    else owed -= balance;
  }
  return { prepaid, owed };
}

/** Each family's balance at the end of a day, per pot: positive — paid ahead, negative — owed. */
export function potBalances(lessons: Lesson[], payments: Payment[], day: string): { studentId: ID; groupId?: ID; balance: number }[] {
  const bal = new Map<string, { studentId: ID; groupId?: ID; balance: number }>();
  const add = (studentId: ID, groupId: ID | undefined, v: number) => {
    const k = `${studentId}|${groupId ?? ''}`;
    const x = bal.get(k);
    if (x) x.balance += v;
    else bal.set(k, { studentId, groupId, balance: v });
  };
  for (const p of payments) if (!p.deletedAt && p.date <= day) add(p.studentId, p.groupId, p.amount);
  for (const l of lessons) {
    if (l.start.slice(0, 10) > day) continue;
    for (const p of l.participants) {
      const c = chargeOf(l, p);
      if (c) add(p.studentId, l.groupId, -c);
    }
  }
  return [...bal.values()];
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE: Record<AccountState, Tone> = { debt: 'bad', empty: 'bad', low: 'warn', ok: 'good', new: 'neutral' };

/** Leftover money that doesn't make a whole lesson. */
const restOf = (x: Pot) => (x.balance > 0 && x.price > 0 ? x.balance - x.lessonsLeft * x.price : 0);

function potText(x: Pot, st: Student): string {
  const rest = restOf(x);
  const tail = rest > 0.5 ? ` + ${money(rest)}` : '';
  switch (x.state) {
    case 'debt':
      return x.unpaidLessons ? `не оплачено ${nPlural(x.unpaidLessons, LESSONS)} · ${money(x.debt)}` : `борг ${money(x.debt)}`;
    case 'empty':
      if (x.paid === 0 && x.charged === 0) return 'ще не оплачено';
      return `оплачені уроки закінчились${rest > 0.5 ? ` · залишок ${money(rest)}` : ''}`;
    case 'new':
      return st.billing === 'after' ? 'оплата після уроку' : 'оплат ще не було';
    default:
      return st.billing === 'after' && x.lessonsLeft === 0 ? 'усе оплачено' : `оплачено ще ${x.lessonsLeft} ${plural(x.lessonsLeft, LESSONS)}${tail}`;
  }
}

/** What a pot is called next to the others. */
function potName(x: Pot, a: Account): string {
  if (!x.groupId) return 'індивідуальні';
  return a.pots.filter((y) => y.groupId).length > 1 ? `група «${x.name}»` : 'група';
}

export function accountLabel(a: Account, st: Student): { text: string; tone: Tone } {
  if (a.state === 'new' || a.pots.length < 2) return { text: potText(a.pots[0], st), tone: TONE[a.state] };
  return { text: a.pots.map((x) => `${potName(x, a)}: ${potText(x, st)}`).join(' · '), tone: TONE[a.state] };
}

/** The pot that pays for lessons of a group (or individual ones). */
export function potOf(a: Account, groupId?: ID): Pot | undefined {
  return a.pots.find((x) => (x.groupId ?? '') === (groupId ?? ''));
}

/** The pot that needs money first; the first one (individual lessons) while all are fine. */
export function urgentPot(a: Account): Pot | undefined {
  return a.pots.reduce<Pot | undefined>((best, x) => (!best || URGENCY[x.state] < URGENCY[best.state] ? x : best), undefined);
}

/** The state of the money that pays for one kind of lessons only. */
export function potLabel(a: Account, st: Student, groupId?: ID): { text: string; tone: Tone } | null {
  const x = potOf(a, groupId);
  return x ? { text: potText(x, st), tone: TONE[x.state] } : null;
}

/** Accounts of every student, recomputed only when the underlying records change. */
let memo: { args: unknown[]; out: Map<ID, Account> } | null = null;

export function allAccounts(
  students: Record<ID, Student>,
  lessonsRec: Record<ID, Lesson>,
  payments: Record<ID, Payment>,
  s: Settings,
  groups: Record<ID, Group> = {},
): Map<ID, Account> {
  const args = [students, lessonsRec, payments, s, groups];
  if (memo && memo.args.every((a, i) => a === args[i])) return memo.out;
  const list = Object.values(payments);
  const out = new Map<ID, Account>();
  for (const st of Object.values(students)) {
    if (st.deletedAt) continue;
    out.set(st.id, buildAccount(st, lessonsOfStudent(lessonsRec, st.id), list, s, groups));
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
  const groups = useData((s) => s.groups);
  return allAccounts(students, lessons, payments, settings, groups);
}
