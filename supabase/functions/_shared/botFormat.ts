/*
 * The bot's texts, shared by the app (previews, cancellations) and the server
 * (reminders), so a family gets exactly what the preview showed. Plain
 * TypeScript without imports: it runs in the browser and in Deno.
 *
 * Lesson times are the school's local time (Kyiv), written 'yyyy-MM-ddTHH:mm'.
 */

export const SCHOOL_ZONE = 'Europe/Kyiv';

/** What a bot message is about. */
export type BotKind = 'cancel' | 'cancelMany' | 'move' | 'free' | 'reminder';

/** When reminders go out, and to whom. Lives on the 'reminder' template. */
export interface ReminderSchedule {
  enabled: boolean;
  /** minutes before the lesson, e.g. [60] */
  before: number[];
  /** 'HH:mm' on the evening before, or '' */
  evening: string;
  /** everyone with the bot, or only the chosen students */
  who: 'all' | 'chosen';
  students: string[];
}

export const NO_REMINDERS: ReminderSchedule = { enabled: false, before: [60], evening: '', who: 'chosen', students: [] };

export const DEFAULT_TEXT: Record<Exclude<BotKind, 'free'>, string> = {
  cancel: "Добрий день! Урок {дата} о {час} скасовано ({ім'я}). Вибачте за незручності.",
  cancelMany: "Добрий день! {період} уроків не буде. Скасовано ({ім'я}):\n{уроки}\nВибачте за незручності.",
  move: "Добрий день! Урок ({ім'я}) перенесено: тепер він {дата} о {час} (замість {було}).",
  reminder: "Добрий день! Нагадую: {дата} о {час} урок ({ім'я}). До зустрічі!",
};

export interface BotValues {
  name: string;
  date?: string;
  time?: string;
  teacher?: string;
  period?: string;
  lessons?: string;
  reason?: string;
  /** where a moved lesson was: «ср, 5 листопада, 16:00» */
  was?: string;
}

export const PLACEHOLDERS: { key: keyof BotValues; token: string; label: string; kinds: BotKind[] }[] = [
  { key: 'name', token: "{ім'я}", label: "ім'я учня", kinds: ['cancel', 'cancelMany', 'move', 'reminder', 'free'] },
  { key: 'date', token: '{дата}', label: 'дата уроку', kinds: ['cancel', 'move', 'reminder'] },
  { key: 'time', token: '{час}', label: 'час уроку', kinds: ['cancel', 'move', 'reminder'] },
  { key: 'was', token: '{було}', label: 'коли було', kinds: ['move'] },
  { key: 'period', token: '{період}', label: 'які дні', kinds: ['cancelMany'] },
  { key: 'lessons', token: '{уроки}', label: 'список уроків', kinds: ['cancelMany'] },
  { key: 'reason', token: '{причина}', label: 'причина', kinds: ['cancel', 'cancelMany', 'move'] },
  { key: 'teacher', token: '{вчителька}', label: 'вчителька', kinds: ['cancel', 'cancelMany', 'move', 'reminder'] },
];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The template with one family's values. A value that opens a sentence gets a
 * capital letter; an empty one leaves no trace — no «()» and no double spaces.
 * Braces that aren't placeholders stay as they are.
 */
export function renderBot(text: string, values: BotValues): string {
  const tokens = new Map(PLACEHOLDERS.map((p) => [p.token, values[p.key] ?? '']));
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/\{[^{}\n]{1,20}\}/g)) {
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

/* ---------- dates ---------- */

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
/** «у середу» */
const WEEKDAY_WHEN = ['понеділок', 'вівторок', 'середу', 'четвер', "п'ятницю", 'суботу', 'неділю'];
const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** The day after (or before, with -1) a 'yyyy-MM-dd'. */
export function shiftDay(day: string, by: number): string {
  const d = dateOf(day);
  d.setUTCDate(d.getUTCDate() + by);
  return keyOf(d);
}

/** «сьогодні», «завтра» or «у середу, 5 листопада». */
export function dayPhrase(day: string, today: string): string {
  if (day === today) return 'сьогодні';
  if (day === shiftDay(today, 1)) return 'завтра';
  const d = dateOf(day);
  return `у ${WEEKDAY_WHEN[isoWeekday(d) - 1]}, ${dayMonth(d)}`;
}

/** «з 10 по 14 листопада», «з 28 листопада по 3 грудня», or one day as dayPhrase. */
export function periodPhrase(from: string, to: string, today: string): string {
  if (from === to) return dayPhrase(from, today);
  const a = dateOf(from);
  const b = dateOf(to);
  return from.slice(0, 7) === to.slice(0, 7) ? `з ${a.getUTCDate()} по ${dayMonth(b)}` : `з ${dayMonth(a)} по ${dayMonth(b)}`;
}

/* ---------- time zones ---------- */

/** How far a zone is ahead of UTC at a moment, in minutes. */
function zoneOffset(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
}

/** The moment (ms) a school-local 'yyyy-MM-ddTHH:mm' happens. */
export function schoolMoment(stamp: string): number {
  const [d, t] = stamp.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = (t ?? '00:00').split(':').map(Number);
  const naive = Date.UTC(y, m - 1, dd, h, mi);
  const first = naive - zoneOffset(SCHOOL_ZONE, naive) * 60000;
  // Once more from the first guess, for the nights the clocks change.
  return naive - zoneOffset(SCHOOL_ZONE, first) * 60000;
}

/** 'yyyy-MM-dd' and 'HH:mm' of a moment in a zone. */
function partsIn(zone: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** The school's date now: 'yyyy-MM-dd' in Kyiv. */
export const schoolToday = (at = Date.now()) => partsIn(SCHOOL_ZONE, at).day;

/** The lesson's time at school, and the family's own when they live in another time zone. */
export function timePhrase(stamp: string, zone?: string): string {
  const here = stamp.slice(11, 16);
  if (!zone || zone === SCHOOL_ZONE) return here;
  let there: string;
  try {
    there = partsIn(zone, schoolMoment(stamp)).time;
  } catch {
    return here; // an unknown zone name
  }
  return there === here ? here : `${here} за Києвом (у вас ${there})`;
}

/** A lesson in short: «ср, 5 листопада, 16:00». */
export function shortLesson(start: string, zone?: string): string {
  const d = dateOf(start.slice(0, 10));
  return `${WEEKDAY_SHORT[isoWeekday(d) - 1]}, ${dayMonth(d)}, ${timePhrase(start, zone)}`;
}

/** One line per lesson, earliest first: «• ср, 5 листопада, 16:00». */
export function lessonLines(starts: string[], zone?: string): string {
  return starts
    .slice()
    .sort()
    .map((s) => `• ${shortLesson(s, zone)}`)
    .join('\n');
}

/* ---------- reminders ---------- */

/** When a lesson's reminders are due: one per rule, with a key that changes when the lesson moves. */
export function reminderMoments(start: string, s: ReminderSchedule): { slot: string; at: number }[] {
  const lessonAt = schoolMoment(start);
  const out = s.before.filter((m) => m > 0 && m <= 24 * 60).map((m) => ({ slot: `${m}@${start}`, at: lessonAt - m * 60000 }));
  if (/^\d{2}:\d{2}$/.test(s.evening)) out.push({ slot: `eve${s.evening}@${start}`, at: schoolMoment(`${shiftDay(start.slice(0, 10), -1)}T${s.evening}`) });
  return out;
}

/** «за 1 год», «за 30 хв», «напередодні о 19:00». */
export function reminderLabel(minutes: number): string {
  if (minutes % 60 === 0) return `за ${minutes / 60} год`;
  if (minutes > 60) return `за ${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
  return `за ${minutes} хв`;
}
