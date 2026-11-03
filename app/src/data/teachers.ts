import { ALL_TEACHERS, MAIN_TEACHER, type DayOff, type Group, type ID, type Lesson, type Student, type Teacher, type TeacherPayout } from './types';

/*
 * Teachers of the school. Every student, group, lesson and day off belongs to
 * one; records from before there were several have no teacherId and belong to
 * MAIN_TEACHER. With a single teacher the app looks exactly as it did before:
 * pickers and teacher names only appear once there is a second one.
 */

export const teacherOf = (x: { teacherId?: ID }): ID => x.teacherId ?? MAIN_TEACHER;

/** Stands in for the main teacher until her card reaches this device (or on a device without an account). */
const FALLBACK_MAIN: Teacher = {
  id: MAIN_TEACHER,
  name: 'Основна вчителька',
  color: 'violet',
  email: '',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
};

const cache = new WeakMap<object, Teacher[]>();
/** Teachers that aren't deleted, the main one first, then by name. */
export function liveTeachers(rec: Record<ID, Teacher>): Teacher[] {
  let out = cache.get(rec);
  if (!out) {
    out = Object.values(rec).filter((t) => !t.deletedAt);
    // Only on a device that has no teacher cards at all; a teacher's own device gets just her card.
    if (out.length === 0) out.push(FALLBACK_MAIN);
    out.sort((a, b) => (a.id === MAIN_TEACHER ? -1 : b.id === MAIN_TEACHER ? 1 : a.name.localeCompare(b.name, 'uk')));
    cache.set(rec, out);
  }
  return out;
}

export function teacherById(rec: Record<ID, Teacher>, id: ID): Teacher {
  return rec[id] ?? (id === MAIN_TEACHER ? FALLBACK_MAIN : { ...FALLBACK_MAIN, id, name: 'Вчителька' });
}

/** Whether a day off covers this teacher's lessons. */
export const dayOffApplies = (d: Pick<DayOff, 'teacherId'>, teacherId: ID) => d.teacherId === ALL_TEACHERS || teacherOf(d) === teacherId;

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface TeacherTies {
  /** students and groups she teaches now (not in the archive) */
  students: number;
  groups: number;
  /** planned lessons still ahead */
  ahead: number;
  /** money the school paid her */
  payouts: number;
  /** her lessons in the past, cancelled ones included: deleting her hands them to the main teacher */
  history: number;
}

/**
 * What a teacher's card still holds. It can be deleted only while she teaches
 * no one, has nothing planned and was never paid; her past lessons are not in
 * the way, they go to the main teacher.
 */
export function teacherTies(
  d: { students: Record<ID, Student>; groups: Record<ID, Group>; lessons: Record<ID, Lesson>; teacherPayouts: Record<ID, TeacherPayout> },
  id: ID,
  now: string,
): TeacherTies {
  const hers = (x: { teacherId?: ID; deletedAt?: number }) => !x.deletedAt && teacherOf(x) === id;
  let ahead = 0;
  let history = 0;
  for (const l of Object.values(d.lessons)) {
    if (!hers(l)) continue;
    if (l.status === 'planned' && l.start >= now) ahead++;
    else history++;
  }
  return {
    students: Object.values(d.students).filter((s) => hers(s) && s.status !== 'archived').length,
    groups: Object.values(d.groups).filter((g) => hers(g) && g.status !== 'archived').length,
    ahead,
    payouts: Object.values(d.teacherPayouts).filter((p) => !p.deletedAt && p.teacherId === id).length,
    history,
  };
}

/** Nothing but the past: the card may be deleted. */
export const canDeleteTeacher = (t: TeacherTies) => t.students + t.groups + t.ahead + t.payouts === 0;
