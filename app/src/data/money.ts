import type { Lesson, Participant } from './types';

export const isTrial = (l: Lesson) => l.kind === 'trial';

/** What the lesson costs this participant once it happened (trial lessons are free). */
export function chargeOf(l: Lesson, p: Participant): number {
  if (l.deletedAt || isTrial(l)) return 0;
  if (l.status === 'done') return p.absent ? 0 : p.price;
  if (l.status === 'cancelled') return l.cancel?.charged ? p.price : 0;
  return 0;
}

export function plannedOf(l: Lesson, p: Participant): number {
  if (l.deletedAt || isTrial(l) || l.status !== 'planned') return 0;
  return p.price;
}

export function lessonEarned(l: Lesson, studentId?: string): number {
  let sum = 0;
  for (const p of l.participants) if (!studentId || p.studentId === studentId) sum += chargeOf(l, p);
  return sum;
}

export function lessonPlanned(l: Lesson, studentId?: string): number {
  let sum = 0;
  for (const p of l.participants) if (!studentId || p.studentId === studentId) sum += plannedOf(l, p);
  return sum;
}

/** Earned if it happened, planned otherwise. */
export const lessonValue = (l: Lesson) => lessonEarned(l) + lessonPlanned(l);
