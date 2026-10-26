import { addDays, addMonths, differenceInCalendarDays, parseISO, startOfMonth } from 'date-fns';
import { cap, dayKey, dayOf, endStamp, fmt, inRange, isoWeekday, type Range } from '../lib/dates';
import { grade1, LESSONS, nPlural, plural } from '../lib/format';
import { dayOffLabel } from './constants';
import { isTrial, lessonEarned, lessonPlanned } from './money';
import type { DayOff, DayOffKind, ID, Lesson, Payment, Student } from './types';

export interface Summary {
  total: number;
  done: number;
  planned: number;
  /** planned lessons (trial ones too) whose time has already passed */
  unmarked: number;
  cancelled: number;
  cancelledByStudent: number;
  cancelledByTeacher: number;
  moved: number;
  /** trial lessons that weren't cancelled; they never count as regular lessons or money */
  trials: number;
  trialsDone: number;
  earned: number;
  expected: number;
  students: number;
  topics: number;
  avgPrice: number;
  avgGrade: number | null;
}

const involves = (l: Lesson, studentId?: ID) => !studentId || l.participants.some((p) => p.studentId === studentId);

export function summarize(lessons: Lesson[], r: Range | null, now: string, studentId?: ID): Summary {
  const out: Summary = {
    total: 0,
    done: 0,
    planned: 0,
    unmarked: 0,
    cancelled: 0,
    cancelledByStudent: 0,
    cancelledByTeacher: 0,
    moved: 0,
    trials: 0,
    trialsDone: 0,
    earned: 0,
    expected: 0,
    students: 0,
    topics: 0,
    avgPrice: 0,
    avgGrade: null,
  };
  const who = new Set<ID>();
  let gradeSum = 0;
  let gradeN = 0;
  let paidLessons = 0;

  for (const l of lessons) {
    if (l.deletedAt || (r && !inRange(dayOf(l.start), r)) || !involves(l, studentId)) continue;
    out.total++;
    if (l.moves.length) out.moved++;
    const past = endStamp(l.start, l.duration) <= now;

    if (isTrial(l)) {
      if (l.status !== 'cancelled') out.trials++;
      if (l.status === 'done') out.trialsDone++;
      else if (l.status === 'planned' && past) out.unmarked++;
      continue;
    }

    if (l.status === 'done') {
      out.done++;
      if (l.topic) out.topics++;
      for (const p of l.participants) {
        if (studentId && p.studentId !== studentId) continue;
        if (!p.absent) who.add(p.studentId);
        if (p.grade) {
          gradeSum += p.grade;
          gradeN++;
        }
      }
    } else if (l.status === 'planned') {
      out.planned++;
      if (past) out.unmarked++;
    } else {
      out.cancelled++;
      if (l.cancel?.by === 'teacher') out.cancelledByTeacher++;
      else out.cancelledByStudent++;
    }
    const earned = lessonEarned(l, studentId);
    if (earned > 0) paidLessons++;
    out.earned += earned;
    out.expected += lessonPlanned(l, studentId);
  }
  out.students = who.size;
  out.avgPrice = paidLessons ? out.earned / paidLessons : 0;
  out.avgGrade = gradeN ? gradeSum / gradeN : null;
  return out;
}

/** Money that actually came in during a period. */
export function received(payments: Payment[], r: Range | null, studentId?: ID) {
  let amount = 0;
  let count = 0;
  for (const p of payments) {
    if (p.deletedAt || (r && !inRange(p.date, r)) || (studentId && p.studentId !== studentId)) continue;
    amount += p.amount;
    count++;
  }
  return { amount, count };
}

export interface MonthPoint {
  key: string;
  label: string;
  longLabel: string;
  earned: number;
  received: number;
  done: number;
  cancelled: number;
  avgGrade: number | null;
  current: boolean;
}

/** One point per month, oldest first, ending with the month of `end`. */
export function monthSeries(
  lessons: Lesson[],
  payments: Payment[],
  end: Date,
  count: number,
  now: string,
  studentId?: ID,
): MonthPoint[] {
  const thisMonth = dayKey(startOfMonth(new Date())).slice(0, 7);
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = startOfMonth(addMonths(end, -i));
    const key = dayKey(m).slice(0, 7);
    const r = { from: `${key}-01`, to: `${key}-31` };
    const sum = summarize(lessons, r, now, studentId);
    out.push({
      key,
      label: fmt(m, 'LLL').replace('.', ''),
      longLabel: cap(fmt(m, 'LLLL yyyy')),
      earned: sum.earned,
      received: received(payments, r, studentId).amount,
      done: sum.done,
      cancelled: sum.cancelled,
      avgGrade: sum.avgGrade,
      current: key === thisMonth,
    });
  }
  return out;
}

/** Lessons per weekday (done + planned) within a range. */
export function weekdayLoad(lessons: Lesson[], r: Range): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const l of lessons) {
    if (l.deletedAt || l.status === 'cancelled' || !inRange(dayOf(l.start), r)) continue;
    out[isoWeekday(parseISO(l.start)) - 1]++;
  }
  return out;
}

export interface Insight {
  kind: 'up' | 'down' | 'warn' | 'info';
  text: string;
  studentId?: ID;
}

export function lastDoneDay(lessons: Lesson[], studentId: ID, now: string): string | null {
  let last: string | null = null;
  for (const l of lessons) {
    if (l.deletedAt || l.status !== 'done' || isTrial(l) || l.start > now) continue;
    if (!l.participants.some((p) => p.studentId === studentId && !p.absent)) continue;
    if (!last || l.start > last) last = l.start;
  }
  return last;
}

/**
 * What changed between two periods, per student. In the current period planned
 * lessons count too, otherwise a half-finished month always looks like a drop.
 */
export function insights(lessons: Lesson[], students: Student[], cur: Range, prev: Range, now: string): Insight[] {
  const out: (Insight & { w: number })[] = [];
  const today = now.slice(0, 10);

  for (const st of students) {
    if (st.deletedAt || st.status === 'archived') continue;
    const a = summarize(lessons, cur, now, st.id);
    const b = summarize(lessons, prev, now, st.id);
    const aCount = a.done + a.planned;

    if (st.status === 'active' && st.startDate <= prev.from) {
      if (b.done >= 2 && aCount <= b.done - 2) {
        out.push({ kind: 'down', w: 3, studentId: st.id, text: `${st.name}: ${nPlural(aCount, LESSONS)} проти ${b.done} у минулому періоді` });
      } else if (b.done > 0 && aCount >= b.done + 2) {
        out.push({ kind: 'up', w: 1, studentId: st.id, text: `${st.name}: ${nPlural(aCount, LESSONS)} — більше, ніж минулого разу (${b.done})` });
      }
    }
    if (a.cancelledByStudent >= 2 && a.cancelledByStudent > b.cancelledByStudent) {
      const n = a.cancelledByStudent;
      out.push({ kind: 'warn', w: 2, studentId: st.id, text: `${st.name}: ${n} ${plural(n, ['скасування', 'скасування', 'скасувань'])} за період` });
    }
    if (a.avgGrade != null && b.avgGrade != null && Math.abs(a.avgGrade - b.avgGrade) >= 0.4) {
      const up = a.avgGrade > b.avgGrade;
      out.push({
        kind: up ? 'up' : 'down',
        w: up ? 1 : 3,
        studentId: st.id,
        text: `${st.name}: засвоєння ${up ? 'зросло' : 'знизилось'} з ${grade1(b.avgGrade)} до ${grade1(a.avgGrade)}`,
      });
    }
    if (st.status === 'active') {
      const last = lastDoneDay(lessons, st.id, now);
      const days = last ? differenceInCalendarDays(parseISO(today), parseISO(last)) : null;
      if (days != null && days >= 14) {
        out.push({ kind: 'warn', w: 2, studentId: st.id, text: `${st.name}: уроків не було вже ${days} ${plural(days, ['день', 'дні', 'днів'])}` });
      }
    }
    if (st.status === 'active' && inRange(st.startDate, cur)) {
      out.push({ kind: 'info', w: 0, studentId: st.id, text: `${st.name}: почали заняття ${fmt(st.startDate, 'd MMMM')}` });
    }
    if (st.status === 'trial' && a.trialsDone > 0) {
      out.push({ kind: 'info', w: 1, studentId: st.id, text: `${st.name}: пробний урок проведено — чекаємо рішення` });
    }
  }
  return out.sort((x, y) => y.w - x.w).slice(0, 8);
}

export function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Trial lessons in a range and how many of those students went on to regular lessons. */
export function trialConversion(lessons: Lesson[], students: Record<ID, Student>, r: Range) {
  const seen = new Set<ID>();
  let converted = 0;
  for (const l of lessons) {
    if (l.deletedAt || !isTrial(l) || l.status !== 'done' || !inRange(dayOf(l.start), r)) continue;
    for (const p of l.participants) {
      if (seen.has(p.studentId)) continue;
      seen.add(p.studentId);
      const st = students[p.studentId];
      if (l.trial?.outcome === 'continue' || (st && st.status === 'active')) converted++;
    }
  }
  return { trials: seen.size, converted };
}

export interface DayOffStat {
  kind: DayOffKind;
  /** days that count: her working days, plus any day whose lessons the mark cancelled */
  days: number;
  /** lessons cancelled because of the mark */
  lessons: number;
  /** what those lessons would have cost */
  amount: number;
}

/** Sick days, vacation and the rest within a period, sick leave first. */
export function daysOffStats(daysOff: DayOff[], lessons: Lesson[], r: Range, workDays: number[]): DayOffStat[] {
  const order: DayOffKind[] = ['sick', 'vacation', 'holiday', 'break', 'dayoff', 'other'];
  const byKind = new Map<DayOffKind, DayOffStat>();
  const counted = new Set<string>();

  for (const d of daysOff) {
    if (d.deletedAt) continue;
    const from = d.from > r.from ? d.from : r.from;
    const to = d.to < r.to ? d.to : r.to;
    if (from > to) continue;
    const reason = dayOffLabel(d.kind);
    const stat = byKind.get(d.kind) ?? { kind: d.kind, days: 0, lessons: 0, amount: 0 };

    const cancelledOn = new Map<string, number>();
    for (const l of lessons) {
      const day = dayOf(l.start);
      if (l.deletedAt || l.status !== 'cancelled' || day < from || day > to) continue;
      if (l.cancel?.by !== 'teacher' || l.cancel.reason !== reason) continue;
      cancelledOn.set(day, (cancelledOn.get(day) ?? 0) + 1);
      stat.lessons++;
      if (!isTrial(l)) stat.amount += l.participants.reduce((sum, p) => sum + p.price, 0);
    }

    for (let day = parseISO(from); dayKey(day) <= to; day = addDays(day, 1)) {
      const key = dayKey(day);
      // overlapping marks shouldn't count the same day twice
      if (counted.has(`${d.kind}:${key}`)) continue;
      if (workDays.includes(isoWeekday(day)) || cancelledOn.has(key)) {
        counted.add(`${d.kind}:${key}`);
        stat.days++;
      }
    }
    byKind.set(d.kind, stat);
  }
  return order.map((k) => byKind.get(k)).filter((x): x is DayOffStat => !!x && (x.days > 0 || x.lessons > 0));
}
