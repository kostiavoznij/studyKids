import { useMemo } from 'react';
import { withCorrections } from './bank';
import { colorHex } from './constants';
import { useData } from './store';
import { missingTaxes, planOf, receivedByMonth, thisMonth } from './taxes';
import type { DayOff, Group, ID, Lesson, Payment, Student, TaxPayment } from './types';

// Derived lists are cached per store snapshot: the records are replaced on every
// change, so a WeakMap keyed by the record object invalidates itself.

const liveCache = new WeakMap<object, Lesson[]>();
export function liveLessons(rec: Record<ID, Lesson>): Lesson[] {
  let out = liveCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((l) => !l.deletedAt)
      .sort((a, b) => a.start.localeCompare(b.start));
    liveCache.set(rec, out);
  }
  return out;
}

const dayCache = new WeakMap<object, Map<string, Lesson[]>>();
export function lessonsByDay(rec: Record<ID, Lesson>): Map<string, Lesson[]> {
  let out = dayCache.get(rec);
  if (!out) {
    out = new Map();
    for (const l of liveLessons(rec)) {
      const k = l.start.slice(0, 10);
      const arr = out.get(k);
      if (arr) arr.push(l);
      else out.set(k, [l]);
    }
    dayCache.set(rec, out);
  }
  return out;
}

const studentCache = new WeakMap<object, Map<ID, Lesson[]>>();
export function lessonsOfStudent(rec: Record<ID, Lesson>, studentId: ID): Lesson[] {
  let byStudent = studentCache.get(rec);
  if (!byStudent) {
    byStudent = new Map();
    for (const l of liveLessons(rec)) {
      for (const p of l.participants) {
        const arr = byStudent.get(p.studentId);
        if (arr) arr.push(l);
        else byStudent.set(p.studentId, [l]);
      }
    }
    studentCache.set(rec, byStudent);
  }
  return byStudent.get(studentId) ?? [];
}

const studentsCache = new WeakMap<object, Student[]>();
export function liveStudents(rec: Record<ID, Student>): Student[] {
  let out = studentsCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    studentsCache.set(rec, out);
  }
  return out;
}

const groupsCache = new WeakMap<object, Group[]>();
export function liveGroups(rec: Record<ID, Group>): Group[] {
  let out = groupsCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((g) => !g.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    groupsCache.set(rec, out);
  }
  return out;
}

const paymentsCache = new WeakMap<object, Payment[]>();
/** Live payments, newest first. */
export function livePayments(rec: Record<ID, Payment>): Payment[] {
  let out = paymentsCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((p) => !p.deletedAt)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    paymentsCache.set(rec, out);
  }
  return out;
}

const daysOffCache = new WeakMap<object, DayOff[]>();
export function liveDaysOff(rec: Record<ID, DayOff>): DayOff[] {
  let out = daysOffCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((d) => !d.deletedAt)
      .sort((a, b) => a.from.localeCompare(b.from));
    daysOffCache.set(rec, out);
  }
  return out;
}

const taxesCache = new WeakMap<object, TaxPayment[]>();
/** Live tax payments, newest first. */
export function liveTaxes(rec: Record<ID, TaxPayment>): TaxPayment[] {
  let out = taxesCache.get(rec);
  if (!out) {
    out = Object.values(rec)
      .filter((t) => !t.deletedAt)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    taxesCache.set(rec, out);
  }
  return out;
}

/** The day-off mark covering a date, if any. */
export const dayOffOn = (list: DayOff[], day: string) => list.find((d) => d.from <= day && day <= d.to);

export const useLiveLessons = () => liveLessons(useData((s) => s.lessons));
export const useLivePayments = () => livePayments(useData((s) => s.payments));
export const useLiveStudents = () => liveStudents(useData((s) => s.students));
export const useLiveGroups = () => liveGroups(useData((s) => s.groups));
export const useDaysOff = () => liveDaysOff(useData((s) => s.daysOff));
export const useLiveTaxes = () => liveTaxes(useData((s) => s.taxes));

export function useTaxPlan() {
  const plans = useData((s) => s.taxPlans);
  const payments = useLivePayments();
  return useMemo(() => planOf(plans, payments), [plans, payments]);
}

/** Money per month: payments plus the differences with the bank she accepted. */
export function useReceived() {
  const payments = useLivePayments();
  const bankMonths = useData((s) => s.bankMonths);
  return useMemo(() => {
    const records = receivedByMonth(payments);
    return { records, money: withCorrections(records, bankMonths) };
  }, [payments, bankMonths]);
}

/** Tax periods that are over and still have nothing entered. */
export function useMissingTaxes() {
  const { plan } = useTaxPlan();
  const taxes = useLiveTaxes();
  const received = useReceived().money;
  const month = thisMonth();
  return useMemo(() => missingTaxes(plan, taxes, received, month), [plan, taxes, received, month]);
}

export function lessonTitle(l: Lesson, students: Record<ID, Student>, groups: Record<ID, Group>): string {
  if (l.groupId && groups[l.groupId]) return groups[l.groupId].name;
  return l.participants.map((p) => students[p.studentId]?.name ?? '—').join(', ');
}

export function lessonColor(l: Lesson, students: Record<ID, Student>, groups: Record<ID, Group>): string {
  if (l.groupId && groups[l.groupId]) return colorHex(groups[l.groupId].color);
  const first = l.participants[0];
  return colorHex(first ? students[first.studentId]?.color ?? 'violet' : 'violet');
}
