import type { DayOffKind, Settings, ThemeId, TrialOutcome } from './types';

export const STUDENT_COLORS: { key: string; hex: string }[] = [
  { key: 'violet', hex: '#7c6cf2' },
  { key: 'blue', hex: '#3b82f6' },
  { key: 'cyan', hex: '#06a8c9' },
  { key: 'teal', hex: '#14a38b' },
  { key: 'green', hex: '#3fa34d' },
  { key: 'lime', hex: '#8aa61c' },
  { key: 'amber', hex: '#e19a12' },
  { key: 'orange', hex: '#ec6a2c' },
  { key: 'red', hex: '#e04a4a' },
  { key: 'pink', hex: '#e04f93' },
  { key: 'fuchsia', hex: '#c254d8' },
  { key: 'brown', hex: '#a07052' },
];

export const colorHex = (key: string) =>
  STUDENT_COLORS.find((c) => c.key === key)?.hex ?? STUDENT_COLORS[0].hex;

export const SUBJECTS = ['Українська мова', 'Читання', 'Українська як іноземна', 'Підготовка до НМТ', 'Література'];

export const TIMEZONES: { zone: string; label: string }[] = [
  { zone: '', label: 'Як у мене' },
  { zone: 'Europe/Warsaw', label: 'Польща' },
  { zone: 'Europe/Berlin', label: 'Німеччина' },
  { zone: 'Europe/Prague', label: 'Чехія' },
  { zone: 'Europe/Vienna', label: 'Австрія' },
  { zone: 'Europe/Rome', label: 'Італія' },
  { zone: 'Europe/Madrid', label: 'Іспанія' },
  { zone: 'Europe/Paris', label: 'Франція' },
  { zone: 'Europe/Amsterdam', label: 'Нідерланди' },
  { zone: 'Europe/Dublin', label: 'Ірландія' },
  { zone: 'Europe/London', label: 'Велика Британія' },
  { zone: 'Europe/Lisbon', label: 'Португалія' },
  { zone: 'Europe/Stockholm', label: 'Швеція' },
  { zone: 'America/New_York', label: 'США (Нью-Йорк)' },
  { zone: 'America/Chicago', label: 'США (Чикаго)' },
  { zone: 'America/Los_Angeles', label: 'США (Лос-Анджелес)' },
  { zone: 'America/Toronto', label: 'Канада (Торонто)' },
  { zone: 'America/Vancouver', label: 'Канада (Ванкувер)' },
  { zone: 'Asia/Dubai', label: 'ОАЕ' },
  { zone: 'Australia/Sydney', label: 'Австралія' },
];

export const zoneLabel = (zone: string) => TIMEZONES.find((t) => t.zone === zone)?.label ?? zone;

export const CANCEL_REASONS = ['Хвороба', 'Поїздка', 'Свята', 'Не попередив', 'Техпроблеми'];
export const MOVE_REASONS = ['Хвороба', 'Інші заняття', 'Поїздка', 'Попросили батьки'];

export const DURATIONS = [30, 45, 60, 90];

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Як у системі' },
  { id: 'light', label: 'Світла' },
  { id: 'dark', label: 'Темна' },
  { id: 'black', label: 'Чорна' },
  { id: 'sand', label: 'Пісочна' },
  { id: 'ocean', label: 'Нічне море' },
  { id: 'mint', label: "М'ятна" },
  { id: 'rose', label: 'Пудрова' },
];

export const TRIAL_LEVELS = ['Початковий', 'Нижче вікової норми', 'Відповідає віку', 'Вище вікової норми'];

export const TRIAL_OUTCOMES: { value: TrialOutcome; label: string }[] = [
  { value: 'continue', label: 'Продовжуємо' },
  { value: 'thinking', label: 'Думають' },
  { value: 'declined', label: 'Не продовжили' },
];

export const DAY_OFF_KINDS: { value: DayOffKind; label: string; short: string }[] = [
  { value: 'dayoff', label: 'Вихідний', short: 'вихідний' },
  { value: 'vacation', label: 'Відпустка', short: 'відпустка' },
  { value: 'sick', label: 'Лікарняний', short: 'лікарн.' },
  { value: 'holiday', label: 'Свято', short: 'свято' },
  { value: 'break', label: 'Канікули', short: 'канікули' },
  { value: 'other', label: 'Інше', short: 'інше' },
];

export const dayOffLabel = (kind: DayOffKind) => DAY_OFF_KINDS.find((k) => k.value === kind)?.label ?? 'Інше';

/** Lesson packages offered when recording a payment. */
export const PACKAGES = [1, 4, 8, 12];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultPrice: 400,
  defaultDuration: 60,
  defaultBilling: 'prepaid',
  lowBalanceLessons: 1,
  workDays: [1, 2, 3, 4, 5],
  dayStart: 9,
  dayEnd: 21,
  horizonWeeks: 6,
  calendarView: 'day',
};
