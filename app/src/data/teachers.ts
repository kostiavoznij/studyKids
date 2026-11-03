import { ALL_TEACHERS, MAIN_TEACHER, type DayOff, type ID, type Teacher } from './types';

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
