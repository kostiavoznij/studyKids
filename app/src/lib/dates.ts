import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  getISODay,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { uk } from 'date-fns/locale';

export const WEEK_OPTS = { weekStartsOn: 1 as const };

/** 'yyyy-MM-dd' */
export const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
/** 'yyyy-MM-ddTHH:mm' */
export const stampOf = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
export const parseStamp = (s: string) => parseISO(s);
export const dayOf = (stamp: string) => stamp.slice(0, 10);
export const timeOf = (stamp: string) => stamp.slice(11, 16);
export const minutesOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
export const endStamp = (stamp: string, duration: number) => stampOf(addMinutes(parseISO(stamp), duration));
export const isoWeekday = (d: Date) => getISODay(d);
export const nowStamp = () => stampOf(new Date());
export const todayKey = () => dayKey(new Date());

export const fmt = (d: Date | string, pattern: string) =>
  format(typeof d === 'string' ? parseISO(d) : d, pattern, { locale: uk });

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
export const WEEKDAYS_LONG = ['понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота', 'неділя'];
export const weekdayShort = (iso: number) => WEEKDAYS_SHORT[iso - 1];

/** «Понеділок, 26 жовтня» */
export const longDay = (d: Date | string) => cap(fmt(d, 'EEEE, d MMMM'));
/** «пн, 26 жовт.» */
export const shortDay = (d: Date | string) => fmt(d, 'EEEEEE, d MMM');

export type Period = 'week' | 'month' | 'year';

export interface Range {
  from: string;
  to: string;
}

export function periodRange(period: Period, anchor: Date): Range {
  if (period === 'week') return { from: dayKey(startOfWeek(anchor, WEEK_OPTS)), to: dayKey(endOfWeek(anchor, WEEK_OPTS)) };
  if (period === 'month') return { from: dayKey(startOfMonth(anchor)), to: dayKey(endOfMonth(anchor)) };
  return { from: dayKey(startOfYear(anchor)), to: dayKey(endOfYear(anchor)) };
}

export function shiftPeriod(period: Period, anchor: Date, by: number): Date {
  if (period === 'week') return addWeeks(anchor, by);
  if (period === 'month') return addMonths(anchor, by);
  return addYears(anchor, by);
}

export function periodLabel(period: Period, anchor: Date): string {
  if (period === 'year') return fmt(anchor, 'yyyy');
  if (period === 'month') return cap(fmt(anchor, 'LLLL yyyy'));
  const s = startOfWeek(anchor, WEEK_OPTS);
  const e = addDays(s, 6);
  return s.getMonth() === e.getMonth()
    ? `${fmt(s, 'd')}–${fmt(e, 'd MMMM')}`
    : `${fmt(s, 'd MMM')} – ${fmt(e, 'd MMM')}`;
}

export const inRange = (key: string, r: Range) => key >= r.from && key <= r.to;

/** Wall-clock time of a local stamp as seen in another IANA zone. */
export function timeInZone(stamp: string, zone: string): string {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(parseISO(stamp));
}

/** True when the zone currently has a different UTC offset from this device. */
export function zoneDiffers(zone: string): boolean {
  if (!zone) return false;
  const now = stampOf(new Date());
  return timeInZone(now, zone) !== timeOf(now);
}
