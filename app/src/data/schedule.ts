import { addDays, addWeeks } from 'date-fns';
import { dayKey, isoWeekday, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
import type { Group, Lesson, Participant, Slot, Student } from './types';

export const studentSlotKey = (studentId: string, slotId: string, day: string) => `s:${studentId}:${slotId}:${day}`;
export const groupSlotKey = (groupId: string, slotId: string, day: string) => `g:${groupId}:${slotId}:${day}`;

function* slotDays(slot: Slot, from: Date, to: Date) {
  let d = from;
  const shift = (slot.weekday - isoWeekday(d) + 7) % 7;
  d = addDays(d, shift);
  while (d <= to) {
    yield dayKey(d);
    d = addDays(d, 7);
  }
}

export function blankLesson(start: string, duration: number, participants: Participant[]): Lesson {
  const now = Date.now();
  return {
    id: uid(),
    start,
    duration,
    participants,
    status: 'planned',
    topic: '',
    homework: '',
    note: '',
    moves: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Lessons that weekly slots call for but that don't exist yet. Soft-deleted
 * lessons keep their slotKey, so a lesson removed by hand is not recreated.
 */
export function missingScheduled(
  students: Student[],
  groups: Group[],
  lessons: Lesson[],
  horizonWeeks: number,
): Lesson[] {
  const taken = new Set<string>();
  for (const l of lessons) if (l.slotKey) taken.add(l.slotKey);

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = addWeeks(from, horizonWeeks);
  const today = todayKey();
  const out: Lesson[] = [];

  for (const s of students) {
    if (s.deletedAt || s.status !== 'active') continue;
    for (const slot of s.schedule) {
      for (const day of slotDays(slot, from, to)) {
        if (day < s.startDate || day < today) continue;
        const key = studentSlotKey(s.id, slot.id, day);
        if (taken.has(key)) continue;
        const l = blankLesson(`${day}T${slot.time}`, slot.duration, [
          { studentId: s.id, price: s.price, currency: s.currency, paid: false },
        ]);
        l.slotKey = key;
        out.push(l);
      }
    }
  }

  for (const g of groups) {
    if (g.deletedAt || g.status !== 'active' || g.studentIds.length === 0) continue;
    for (const slot of g.schedule) {
      for (const day of slotDays(slot, from, to)) {
        const key = groupSlotKey(g.id, slot.id, day);
        if (taken.has(key)) continue;
        const l = blankLesson(
          `${day}T${slot.time}`,
          slot.duration,
          g.studentIds.map((id) => ({ studentId: id, price: g.price, currency: g.currency, paid: false })),
        );
        l.groupId = g.id;
        l.slotKey = key;
        out.push(l);
      }
    }
  }
  return out;
}

/** A future lesson nobody has touched yet — safe to drop when the schedule changes. */
export function isUntouchedFuture(l: Lesson, nowStamp: string): boolean {
  return (
    !l.deletedAt &&
    l.status === 'planned' &&
    l.start >= nowStamp &&
    l.moves.length === 0 &&
    !l.topic &&
    !l.homework &&
    !l.note
  );
}

/** Slot ids whose weekday/time/duration changed or that disappeared. */
export function changedSlots(before: Slot[], after: Slot[]): Set<string> {
  const out = new Set<string>();
  for (const old of before) {
    const now = after.find((s) => s.id === old.id);
    if (!now || now.weekday !== old.weekday || now.time !== old.time || now.duration !== old.duration) out.add(old.id);
  }
  return out;
}

/** Changed slots get a fresh id so new lessons don't collide with old slot keys. */
export function reissueChanged(after: Slot[], changed: Set<string>): Slot[] {
  return after.map((s) => (changed.has(s.id) ? { ...s, id: uid() } : s));
}

export const slotKeyOwner = (key: string) => {
  const [kind, owner, slotId] = key.split(':');
  return { kind, owner, slotId };
};
