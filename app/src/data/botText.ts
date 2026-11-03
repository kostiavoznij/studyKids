import { addDays, getISODay, parseISO } from 'date-fns';
import { dayKey, fmt, timeInZone, timeOf, todayKey } from '../lib/dates';
import type { BotKind, BotTemplate, ID, Lesson, Student } from './types';

/*
 * The bot's texts. A template is plain text with placeholders in braces —
 * {ім'я}, {дата}, {час}… — and every family gets it with its own values. The
 * built-in templates ('cancel', 'cancelMany') have default texts; she can edit
 * them, and keep her own ones for free messages.
 */

export const BUILT_IN: Record<Exclude<BotKind, 'free'>, { name: string; text: string; when: string }> = {
  cancel: {
    name: 'Урок скасовано',
    text: "Добрий день! Урок {дата} о {час} скасовано ({ім'я}). Вибачте за незручності.",
    when: 'Пропонується, коли ви скасовуєте урок.',
  },
  cancelMany: {
    name: 'Кілька днів без уроків',
    text: "Добрий день! {період} уроків не буде. Скасовано ({ім'я}):\n{уроки}\nВибачте за незручності.",
    when: 'Пропонується, коли ви позначаєте вихідний, лікарняний чи відпустку.',
  },
};

/** The text of a template kind as it is now: her edited one, or the default. */
export function templateText(rec: Record<ID, BotTemplate>, kind: Exclude<BotKind, 'free'>): string {
  const t = rec[kind];
  return t && !t.deletedAt ? t.text : BUILT_IN[kind].text;
}

/** Her own templates for free messages, by name. */
export const ownTemplates = (rec: Record<ID, BotTemplate>) =>
  Object.values(rec)
    .filter((t) => t.kind === 'free' && !t.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));

export interface BotValues {
  name: string;
  date?: string;
  time?: string;
  teacher?: string;
  period?: string;
  lessons?: string;
  reason?: string;
}

export const PLACEHOLDERS: { key: keyof BotValues; token: string; label: string; kinds: BotKind[] }[] = [
  { key: 'name', token: "{ім'я}", label: "ім'я учня", kinds: ['cancel', 'cancelMany', 'free'] },
  { key: 'date', token: '{дата}', label: 'дата уроку', kinds: ['cancel'] },
  { key: 'time', token: '{час}', label: 'час уроку', kinds: ['cancel'] },
  { key: 'period', token: '{період}', label: 'які дні', kinds: ['cancelMany'] },
  { key: 'lessons', token: '{уроки}', label: 'список уроків', kinds: ['cancelMany'] },
  { key: 'reason', token: '{причина}', label: 'причина', kinds: ['cancel', 'cancelMany'] },
  { key: 'teacher', token: '{вчителька}', label: 'вчителька', kinds: ['cancel', 'cancelMany'] },
];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The template with this family's values. A value that opens a sentence gets a
 * capital letter; an empty one leaves no trace — no «()» and no double spaces.
 */
export function renderBot(text: string, values: BotValues): string {
  let out = '';
  const tokens = new Map(PLACEHOLDERS.map((p) => [p.token, values[p.key] ?? '']));
  const re = /\{[^{}\n]{1,20}\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const value = tokens.get(m[0]);
    if (value === undefined) continue;
    out += text.slice(last, m.index);
    const opensSentence = out.trim() === '' || /[.!?]\s*$/.test(out) || /\n\s*$/.test(out);
    out += opensSentence ? capFirst(value) : value;
    last = (m.index ?? 0) + m[0].length;
  }
  out += text.slice(last);
  return out
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,!?:;])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/* ---------- values ---------- */

const WEEKDAY_WHEN = ['понеділок', 'вівторок', 'середу', 'четвер', "п'ятницю", 'суботу', 'неділю'];

/** «сьогодні», «завтра» or «у середу, 5 листопада». */
export function dayPhrase(day: string, today = todayKey()): string {
  if (day === today) return 'сьогодні';
  if (day === dayKey(addDays(parseISO(today), 1))) return 'завтра';
  const d = parseISO(day);
  return `у ${WEEKDAY_WHEN[getISODay(d) - 1]}, ${fmt(d, 'd MMMM')}`;
}

/** «з 10 по 14 листопада», «з 28 листопада по 3 грудня», or one day as dayPhrase. */
export function periodPhrase(from: string, to: string, today = todayKey()): string {
  if (from === to) return dayPhrase(from, today);
  const a = parseISO(from);
  const b = parseISO(to);
  return from.slice(0, 7) === to.slice(0, 7) ? `з ${fmt(a, 'd')} по ${fmt(b, 'd MMMM')}` : `з ${fmt(a, 'd MMMM')} по ${fmt(b, 'd MMMM')}`;
}

/** The lesson's time here, and the family's own when they live in another time zone. */
export function timePhrase(stamp: string, zone?: string): string {
  const here = timeOf(stamp);
  if (!zone) return here;
  const there = timeInZone(stamp, zone);
  return there === here ? here : `${here} за Києвом (у вас ${there})`;
}

/** One line per lesson: «• ср, 5 листопада, 16:00». */
export const lessonLines = (lessons: Lesson[], zone?: string) =>
  lessons
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((l) => `• ${fmt(parseISO(l.start.slice(0, 10)), 'EEEEEE, d MMMM')}, ${timePhrase(l.start, zone)}`)
    .join('\n');

/** Example values, for the preview while editing a template. */
export function sampleValues(student?: Student, teacher = ''): BotValues {
  const t = todayKey();
  const d1 = dayKey(addDays(parseISO(t), 3));
  const d2 = dayKey(addDays(parseISO(t), 5));
  return {
    name: student?.name ?? 'Варя',
    date: 'завтра',
    time: '16:00',
    teacher,
    period: periodPhrase(d1, d2, t),
    lessons: lessonLines([{ start: `${d1}T16:00` } as Lesson, { start: `${d2}T16:00` } as Lesson]),
    reason: 'хвороба',
  };
}
