import {
  DEFAULT_TEXT,
  lessonLines,
  NO_REMINDERS,
  periodPhrase,
  shiftDay,
  type BotKind,
  type BotValues,
  type ReminderSchedule,
} from '../../../supabase/functions/_shared/botFormat';
import { todayKey } from '../lib/dates';
import type { BotTemplate, ID, Student } from './types';

/*
 * The bot's texts in the app. The formatting itself — placeholders, dates,
 * times, reminders — lives in supabase/functions/_shared/botFormat.ts, shared
 * with the server, so what the preview shows is what the family gets.
 */

export {
  dayPhrase,
  lessonLines,
  NO_REMINDERS,
  periodPhrase,
  PLACEHOLDERS,
  reminderLabel,
  renderBot,
  timePhrase,
  type BotValues,
  type ReminderSchedule,
} from '../../../supabase/functions/_shared/botFormat';

export const BUILT_IN: Record<Exclude<BotKind, 'free'>, { name: string; text: string; when: string }> = {
  cancel: {
    name: 'Урок скасовано',
    text: DEFAULT_TEXT.cancel,
    when: 'Пропонується, коли ви скасовуєте урок.',
  },
  cancelMany: {
    name: 'Кілька днів без уроків',
    text: DEFAULT_TEXT.cancelMany,
    when: 'Пропонується, коли ви позначаєте вихідний, лікарняний чи відпустку.',
  },
  reminder: {
    name: 'Нагадування перед уроком',
    text: DEFAULT_TEXT.reminder,
    when: 'Надсилається саме, за налаштуваннями нагадувань.',
  },
};

/** The text of a built-in kind as it is now: her edited one, or the default. */
export function templateText(rec: Record<ID, BotTemplate>, kind: Exclude<BotKind, 'free'>): string {
  const t = rec[kind];
  return t && !t.deletedAt && t.text ? t.text : BUILT_IN[kind].text;
}

/** When reminders go out and to whom; off until she turns them on. */
export function reminderSchedule(rec: Record<ID, BotTemplate>): ReminderSchedule {
  const t = rec.reminder;
  return t && !t.deletedAt && t.schedule ? { ...NO_REMINDERS, ...t.schedule } : NO_REMINDERS;
}

/** Her own templates for free messages, by name. */
export const ownTemplates = (rec: Record<ID, BotTemplate>) =>
  Object.values(rec)
    .filter((t) => t.kind === 'free' && !t.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));

/** Example values, for the preview while editing a template. */
export function sampleValues(student?: Student, teacher = ''): BotValues {
  const t = todayKey();
  const d1 = shiftDay(t, 3);
  const d2 = shiftDay(t, 5);
  return {
    name: student?.name ?? 'Варя',
    date: 'завтра',
    time: '16:00',
    teacher,
    period: periodPhrase(d1, d2, t),
    lessons: lessonLines([`${d1}T16:00`, `${d2}T16:00`]),
    reason: 'хвороба',
  };
}
