import { colorHex } from './constants';
import { useData } from './store';
import type { Group, ID, Lesson, Payment, Student } from './types';

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

export const useLiveLessons = () => liveLessons(useData((s) => s.lessons));
export const useLivePayments = () => livePayments(useData((s) => s.payments));
export const useLiveStudents = () => liveStudents(useData((s) => s.students));
export const useLiveGroups = () => liveGroups(useData((s) => s.groups));

export function lessonTitle(l: Lesson, students: Record<ID, Student>, groups: Record<ID, Group>): string {
  if (l.groupId && groups[l.groupId]) return groups[l.groupId].name;
  return l.participants.map((p) => students[p.studentId]?.name ?? '—').join(', ');
}

export function lessonColor(l: Lesson, students: Record<ID, Student>, groups: Record<ID, Group>): string {
  if (l.groupId && groups[l.groupId]) return colorHex(groups[l.groupId].color);
  const first = l.participants[0];
  return colorHex(first ? students[first.studentId]?.color ?? 'violet' : 'violet');
}
