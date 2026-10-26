import { addDays, addWeeks } from 'date-fns';
import { dayKey, isoWeekday, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
import { dayOffLabel } from './constants';
import type { DayOff, Group, ID, Lesson, Participant, Slot, Student } from './types';

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
 * A lesson made by the weekly schedule. Its id comes from the slot key, so two
 * devices generating the same week produce the same record instead of duplicates,
 * and its timestamps are 1 so that any real edit or deletion wins a sync merge.
 */
function generated(key: string, start: string, duration: number, participants: Participant[]): Lesson {
  const l = blankLesson(start, duration, participants);
  l.id = key;
  l.slotKey = key;
  l.createdAt = 1;
  l.updatedAt = 1;
  return l;
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
  daysOff: DayOff[] = [],
): Lesson[] {
  // Days marked as vacation/sick leave get their lessons already cancelled.
  const offRanges = daysOff.filter((d) => !d.deletedAt && d.cancelLessons);
  const offFor = (day: string) => offRanges.find((d) => d.from <= day && day <= d.to);
  const cancelIfOff = (l: Lesson) => {
    const off = offFor(l.start.slice(0, 10));
    if (off) {
      l.status = 'cancelled';
      l.cancel = { by: 'teacher', reason: dayOffLabel(off.kind), charged: false, at: 1 };
    }
    return l;
  };

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
        out.push(cancelIfOff(generated(key, `${day}T${slot.time}`, slot.duration, [{ studentId: s.id, price: s.price }])));
      }
    }
  }

  for (const g of groups) {
    if (g.deletedAt || g.status !== 'active' || g.studentIds.length === 0) continue;
    for (const slot of g.schedule) {
      for (const day of slotDays(slot, from, to)) {
        const key = groupSlotKey(g.id, slot.id, day);
        if (taken.has(key)) continue;
        const l = generated(
          key,
          `${day}T${slot.time}`,
          slot.duration,
          g.studentIds.map((id) => ({ studentId: id, price: g.price })),
        );
        l.groupId = g.id;
        out.push(cancelIfOff(l));
      }
    }
  }
  return out;
}

/** A future lesson nobody has touched yet — safe to drop when the schedule changes. */
export function isUntouchedFuture(l: Lesson, nowStamp: string): boolean {
  // A lesson the schedule generated straight into a day off (cancel.at === 1) counts as untouched too.
  const autoCancelled = l.status === 'cancelled' && l.cancel?.at === 1;
  return (
    !l.deletedAt &&
    (l.status === 'planned' || autoCancelled) &&
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

/**
 * Untouched future lessons whose slot no longer exists (schedule edited, student
 * paused) — e.g. generated on another device before it saw the change.
 */
export function orphanedScheduled(
  students: Record<ID, Student>,
  groups: Record<ID, Group>,
  lessons: Lesson[],
  nowStamp: string,
): Lesson[] {
  return lessons.filter((l) => {
    if (!l.slotKey || !isUntouchedFuture(l, nowStamp)) return false;
    const k = slotKeyOwner(l.slotKey);
    const owner = k.kind === 'g' ? groups[k.owner] : students[k.owner];
    return !owner || !!owner.deletedAt || owner.status !== 'active' || !owner.schedule.some((sl) => sl.id === k.slotId);
  });
}
