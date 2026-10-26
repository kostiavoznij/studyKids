import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerUpRight,
  Plus,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type Ref } from 'react';
import { accountLabel, needsPayment, useAccounts, type Account } from '../data/billing';
import { isTrial, lessonValue } from '../data/money';
import { lessonColor, lessonsByDay, lessonTitle, liveLessons } from '../data/selectors';
import { summarize } from '../data/stats';
import { useData } from '../data/store';
import type { CalendarView, Lesson, Student } from '../data/types';
import {
  cap,
  dayKey,
  endStamp,
  fmt,
  longDay,
  minutesOf,
  timeOf,
  todayKey,
  WEEK_OPTS,
  WEEKDAYS_SHORT,
  weekdayShort,
  isoWeekday,
} from '../lib/dates';
import { LESSONS, money, nPlural, tiny, TRIALS } from '../lib/format';
import { Avatar, Money, Segmented, Tile, useNow, useSwipe } from '../ui/components';
import { navigate } from '../ui/router';
import { useUi } from '../ui/uiStore';
import { SyncBadge } from './SyncSection';

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export function CalendarScreen() {
  const view = useData((s) => s.settings.calendarView);
  const updateSettings = useData((s) => s.updateSettings);
  const rec = useData((s) => s.lessons);
  const selected = useUi((s) => s.day) ?? todayKey();
  const setDay = useUi((s) => s.setDay);
  const open = useUi((s) => s.open);
  const now = useNow();
  const today = now.slice(0, 10);
  const date = parseISO(selected);
  const byDay = lessonsByDay(rec);

  const setView = (v: CalendarView) => updateSettings({ calendarView: v });
  const shift = (dir: -1 | 1) => {
    const next = view === 'day' ? addDays(date, dir) : view === 'week' ? addWeeks(date, dir) : addMonths(date, dir);
    setDay(dayKey(next));
  };

  const addLesson = () => {
    const dayLessons = (byDay.get(selected) ?? []).filter((l) => l.status !== 'cancelled');
    let start = 14 * 60;
    if (dayLessons.length) {
      const last = dayLessons[dayLessons.length - 1];
      start = minutesOf(last.start) + last.duration;
    }
    if (selected === today) start = Math.max(start, Math.ceil((minutesOf(now) + 1) / 60) * 60);
    start = Math.min(start, 23 * 60);
    open({ kind: 'newLesson', start: `${selected}T${hhmm(start)}` });
  };

  const isCurrent =
    view === 'day'
      ? selected === today
      : view === 'week'
        ? dayKey(startOfWeek(date, WEEK_OPTS)) === dayKey(startOfWeek(parseISO(today), WEEK_OPTS))
        : selected.slice(0, 7) === today.slice(0, 7);

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="sticky-head">
          <div className="cal-head">
            <div className="cal-title">
              <h1>{cap(fmt(date, 'LLLL'))}</h1>
              <span className="year">{fmt(date, 'yyyy')}</span>
            </div>
            <SyncBadge />
            {!isCurrent && (
              <button className="btn btn-soft btn-sm" onClick={() => setDay(today)}>
                Сьогодні
              </button>
            )}
            <button className="icon-btn" onClick={() => shift(-1)} aria-label="Назад">
              <ChevronLeft size={22} />
            </button>
            <button className="icon-btn" onClick={() => shift(1)} aria-label="Вперед">
              <ChevronRight size={22} />
            </button>
          </div>
          <div className="cal-controls">
            <Segmented label="Вигляд календаря" value={view} options={VIEWS} onChange={setView} />
          </div>
          {view === 'day' && <WeekStrip selected={selected} today={today} byDay={byDay} onPick={setDay} />}
        </div>

        {view === 'day' && <DayView key={selected} day={selected} byDay={byDay} now={now} />}
        {view === 'week' && <WeekView key={dayKey(startOfWeek(date, WEEK_OPTS))} date={date} byDay={byDay} now={now} />}
        {view === 'month' && <MonthView key={selected.slice(0, 7)} date={date} byDay={byDay} now={now} />}
      </div>
      <button className="fab" onClick={addLesson} aria-label="Новий урок">
        <Plus size={28} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/* ---------- Week strip (day view header) ---------- */

function WeekStrip({
  selected,
  today,
  byDay,
  onPick,
}: {
  selected: string;
  today: string;
  byDay: Map<string, Lesson[]>;
  onPick: (d: string) => void;
}) {
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const start = startOfWeek(parseISO(selected), WEEK_OPTS);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const swipe = useSwipe((dir) => onPick(dayKey(addDays(parseISO(selected), dir * 7))));

  return (
    <div className="week-strip" {...swipe}>
      {days.map((d) => {
        const k = dayKey(d);
        const ls = (byDay.get(k) ?? []).filter((l) => l.status !== 'cancelled');
        return (
          <button key={k} className="ws-day" aria-pressed={k === selected} data-today={k === today ? '' : undefined} onClick={() => onPick(k)}>
            <span className="ws-wd">{weekdayShort(isoWeekday(d))}</span>
            <span className="ws-num">{d.getDate()}</span>
            <span className="ws-dots">
              {ls.slice(0, 5).map((l) => (
                <i key={l.id} style={{ '--c': lessonColor(l, students, groups) } as CSSProperties} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Day ---------- */

function DayView({ day, byDay, now }: { day: string; byDay: Map<string, Lesson[]>; now: string }) {
  const rec = useData((s) => s.lessons);
  const markManyDone = useData((s) => s.markManyDone);
  const putLesson = useData((s) => s.putLesson);
  const setDay = useUi((s) => s.setDay);
  const notify = useUi((s) => s.notify);
  const lessons = byDay.get(day) ?? [];
  const sum = summarize(lessons, null, now);
  const activeCount = sum.done + sum.planned;
  const today = now.slice(0, 10);
  const swipe = useSwipe((dir) => setDay(dayKey(addDays(parseISO(day), dir))));

  // Trial lessons need a report, so they are not bulk-marked.
  const unmarked = lessons.filter((l) => l.status === 'planned' && !isTrial(l) && endStamp(l.start, l.duration) <= now);
  const olderUnmarked =
    day === today
      ? liveLessons(rec).filter((l) => l.status === 'planned' && !isTrial(l) && l.start.slice(0, 10) < today)
      : [];

  const markAll = (list: Lesson[]) => {
    const before = list.map((l) => ({ ...l }));
    markManyDone(list.map((l) => l.id));
    notify(`${nPlural(list.length, LESSONS)} відмічено як проведені`, () => before.forEach(putLesson));
  };

  return (
    <div className="view-anim" {...swipe}>
      {olderUnmarked.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <CircleAlert size={20} />
          <span style={{ flex: 1 }}>
            За минулі дні не відмічено {nPlural(olderUnmarked.length, LESSONS)}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={() => setDay(olderUnmarked[0].start.slice(0, 10))}>
            Показати
          </button>
        </div>
      )}

      {day === today && <PaymentReminders />}

      <div className="card day-summary">
        <div className="ds-top">
          <div>
            <div className="ds-date">{longDay(day)}</div>
            <div className="ds-main">
              {activeCount ? nPlural(activeCount, LESSONS) : sum.trials ? '' : 'Вільний день'}
              {sum.trials > 0 && <span className="ds-trial">{activeCount ? ' + ' : ''}{nPlural(sum.trials, TRIALS)}</span>}
            </div>
          </div>
          {sum.earned + sum.expected > 0 && (
            <div className="ds-money">
              <div className="big">
                <Money value={sum.earned + sum.expected} />
              </div>
              <div className="small">
                {sum.expected > 0 && sum.earned > 0
                  ? `зароблено ${money(sum.earned)}`
                  : sum.earned > 0
                    ? 'зароблено'
                    : 'заплановано'}
              </div>
            </div>
          )}
        </div>
        {activeCount > 0 && (
          <>
            <div className="progress" aria-hidden="true">
              <span style={{ width: `${(sum.done / activeCount) * 100}%` }} />
            </div>
            <div className="faint" style={{ fontSize: 13, fontWeight: 650, marginTop: -4 }}>
              Проведено {sum.done} з {activeCount}
              {sum.cancelled > 0 && ` · скасовано ${sum.cancelled}`}
              {sum.moved > 0 && ` · перенесено ${sum.moved}`}
            </div>
          </>
        )}
        {unmarked.length > 0 && (
          <div className="banner warn">
            <CircleAlert size={20} />
            <span style={{ flex: 1 }}>Потрібно відмітити: {nPlural(unmarked.length, LESSONS)}</span>
            <button className="btn btn-sm btn-primary" onClick={() => markAll(unmarked)}>
              Проведено
            </button>
          </div>
        )}
      </div>

      <Timeline day={day} lessons={lessons} now={now} />
    </div>
  );
}

/** Families whose prepaid lessons ran out (or who owe) — a one-line banner on today's page. */
function PaymentReminders() {
  const students = useData((s) => s.students);
  const open = useUi((s) => s.open);
  const accounts = useAccounts();
  const list = needsPayment(accounts, students);
  const [expanded, setExpanded] = useState(false);
  if (list.length === 0) return null;
  const names = list.slice(0, 3).map((a) => students[a.studentId].name);
  return (
    <div className="pay-remind" data-open={expanded ? '' : undefined}>
      <button className="pay-banner" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <Wallet size={18} />
        <span>
          Нагадати про оплату: <b>{names.join(', ')}</b>
          {list.length > 3 && ` +${list.length - 3}`}
        </span>
        <ChevronDown size={18} className="pay-chevron" />
      </button>
      {expanded &&
        list.map((a) => {
          const st = students[a.studentId];
          const label = accountLabel(a, st);
          return (
            <div key={a.studentId} className="pay-row">
              <button className="pay-who" onClick={() => navigate(`/students/${st.id}`)}>
                <Avatar name={st.name} color={st.color} size={32} />
                <span>
                  <b>{st.name}</b>
                  <span className={`pay-state ${label.tone}`}>{label.text}</span>
                </span>
              </button>
              <button className="btn btn-sm btn-soft" onClick={() => open({ kind: 'payment', studentId: st.id })}>
                Внести
              </button>
            </div>
          );
        })}
    </div>
  );
}

const HOUR = 68;

/** Side-by-side columns for lessons that overlap in time. */
function layout(lessons: Lesson[]) {
  const items = lessons
    .map((l) => ({ l, s: minutesOf(l.start), e: minutesOf(l.start) + l.duration, col: 0, cols: 1 }))
    .sort((a, b) => a.s - b.s);
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const it of cluster) {
      let c = ends.findIndex((e) => e <= it.s);
      if (c === -1) c = ends.length;
      ends[c] = it.e;
      it.col = c;
    }
    for (const it of cluster) it.cols = ends.length;
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return items;
}

/**
 * Hours the grid shows. With lessons it hugs them (plus an hour of air and the
 * current time) so a typical afternoon fits on screen; an empty day shows the
 * working hours from settings.
 */
function hourBounds(lessons: Lesson[], dayStart: number, dayEnd: number, nowMin?: number) {
  if (lessons.length === 0) return { startH: dayStart, endH: dayEnd };
  let startH = 24;
  let endH = 0;
  for (const l of lessons) {
    const m = minutesOf(l.start);
    startH = Math.min(startH, Math.floor(m / 60));
    endH = Math.max(endH, Math.ceil((m + l.duration) / 60));
  }
  if (nowMin != null) {
    startH = Math.min(startH, Math.floor(nowMin / 60));
    endH = Math.max(endH, Math.ceil(nowMin / 60));
  }
  startH = Math.max(0, startH - 1);
  endH = Math.min(24, endH + 1);
  return { startH, endH };
}

function Timeline({ day, lessons, now }: { day: string; lessons: Lesson[]; now: string }) {
  const { dayStart, dayEnd } = useData((s) => s.settings);
  const open = useUi((s) => s.open);
  const target = useRef<HTMLElement | null>(null);
  const setTarget = (el: HTMLElement | null) => {
    target.current = el;
  };
  const isToday = day === now.slice(0, 10);
  const nowMin = minutesOf(now);
  const { startH, endH } = hourBounds(lessons, dayStart, dayEnd, isToday ? nowMin : undefined);
  const top = (min: number) => ((min - startH * 60) / 60) * HOUR;
  const showNow = isToday && nowMin >= startH * 60 && nowMin <= endH * 60;
  const placed = layout(lessons);
  const firstActive = placed.find((p) => p.l.status !== 'cancelled') ?? placed[0];

  // Bring the current time (or the first lesson) into view, but only if it's off screen.
  useEffect(() => {
    target.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const onEmptyClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el !== e.currentTarget && !el.classList.contains('tl-hour')) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.min(23 * 60 + 30, Math.max(0, Math.round((startH * 60 + (y / HOUR) * 60) / 30) * 30));
    open({ kind: 'newLesson', start: `${day}T${hhmm(min)}` });
  };

  return (
    <div className="timeline" style={{ height: (endH - startH) * HOUR + 20 }} onClick={onEmptyClick}>
      {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map((h) => (
        <div key={h} className="tl-hour" style={{ height: h === endH ? 0 : HOUR }}>
          <span>{pad(h)}:00</span>
        </div>
      ))}
      {showNow && <div className="tl-now" style={{ top: top(nowMin) }} ref={setTarget} />}
      {placed.map(({ l, s, col, cols }, i) => (
        <LessonBlock
          key={l.id}
          lesson={l}
          now={now}
          refEl={!showNow && firstActive?.l === l ? setTarget : undefined}
          delay={i * 30}
          style={{
            top: top(s) + 2,
            height: Math.max(26, (l.duration / 60) * HOUR - 4),
            left: `calc(${(col / cols) * 100}% + 6px)`,
            width: `calc(${100 / cols}% - ${cols > 1 ? 8 : 6}px)`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------- A lesson on the grid ---------- */

function LessonBlock({
  lesson,
  now,
  style,
  narrow,
  refEl,
  delay = 0,
}: {
  lesson: Lesson;
  now: string;
  style: CSSProperties;
  narrow?: boolean;
  refEl?: Ref<HTMLButtonElement>;
  delay?: number;
}) {
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const open = useUi((s) => s.open);
  const accounts = useAccounts();
  const title = lessonTitle(lesson, students, groups);
  const trial = isTrial(lesson);
  const color = lessonColor(lesson, students, groups);
  const end = endStamp(lesson.start, lesson.duration);
  const status = lesson.status === 'planned' && end <= now ? 'unmarked' : lesson.status;
  const time = `${timeOf(lesson.start)}–${timeOf(end)}`;
  const subject = lesson.groupId ? '' : students[lesson.participants[0]?.studentId]?.subject ?? '';
  const detail =
    status === 'cancelled'
      ? `скасовано${lesson.cancel?.reason ? ` · ${lesson.cancel.reason.toLowerCase()}` : ''}`
      : trial
        ? 'пробний урок'
        : lesson.topic || subject;
  const unpaid = !trial && status !== 'cancelled' && isUnpaid(lesson, students, accounts);
  const height = typeof style.height === 'number' ? style.height : 60;
  const compactRow = height < 44;
  const value = lessonValue(lesson);

  const icon =
    trial && status !== 'cancelled' ? (
      <Sparkles size={narrow ? 13 : 16} strokeWidth={2.4} />
    ) : status === 'done' ? (
      <CircleCheck size={narrow ? 13 : 17} strokeWidth={2.4} />
    ) : status === 'unmarked' ? (
      <CircleDashed size={narrow ? 13 : 17} strokeWidth={2.4} />
    ) : lesson.moves.length && status === 'planned' ? (
      <CornerUpRight size={narrow ? 13 : 16} strokeWidth={2.4} />
    ) : null;

  return (
    <button
      ref={refEl}
      className={`lesson-block${compactRow ? ' compact' : ''}`}
      data-status={status}
      data-kind={trial ? 'trial' : undefined}
      style={{ ...style, '--c': color, animationDelay: `${delay}ms` } as CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        open({ kind: 'lesson', id: lesson.id });
      }}
      aria-label={`${title}, ${time}`}
    >
      <span className="lb-row">
        {lesson.groupId && <Users size={narrow ? 11 : 14} strokeWidth={2.4} style={{ flex: 'none' }} />}
        <span className="lb-name">{title}</span>
        {!narrow && !compactRow && value > 0 && status !== 'cancelled' && (
          <span className="lb-price">{money(value)}</span>
        )}
        {unpaid && (
          <span className="lb-unpaid" title="Не оплачено">
            <Wallet size={narrow ? 11 : 14} strokeWidth={2.4} />
          </span>
        )}
        {icon && <span className="lb-icon">{icon}</span>}
      </span>
      {compactRow ? (
        !narrow && <span className="lb-meta">{time}</span>
      ) : (
        <span className="lb-meta">
          {narrow ? timeOf(lesson.start) : time}
          {!narrow && detail ? ` · ${detail}` : ''}
        </span>
      )}
    </button>
  );
}

/**
 * A lesson the family hasn't paid for: after-the-fact for anyone who owes,
 * in advance only for prepaying families (the others pay after the lesson).
 */
function isUnpaid(l: Lesson, students: Record<string, Student>, accounts: Map<string, Account>) {
  if (l.groupId || l.participants.length !== 1) return false;
  const p = l.participants[0];
  const st = students[p.studentId];
  const a = accounts.get(p.studentId);
  if (!st || !a || p.price <= 0) return false;
  if (l.status === 'done') return !a.covered.has(l.id);
  return st.billing === 'prepaid' && !a.coveredPlanned.has(l.id);
}

/* ---------- Week ---------- */

const WHOUR = 52;

function WeekView({ date, byDay, now }: { date: Date; byDay: Map<string, Lesson[]>; now: string }) {
  const settings = useData((s) => s.settings);
  const updateSettings = useData((s) => s.updateSettings);
  const setDay = useUi((s) => s.setDay);
  const open = useUi((s) => s.open);
  const start = startOfWeek(date, WEEK_OPTS);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const all = days.flatMap((d) => byDay.get(dayKey(d)) ?? []);
  const hasToday = days.some((d) => dayKey(d) === now.slice(0, 10));
  const { startH, endH } = hourBounds(all, settings.dayStart, settings.dayEnd, hasToday ? minutesOf(now) : undefined);
  const height = (endH - startH) * WHOUR;
  const top = (min: number) => ((min - startH * 60) / 60) * WHOUR;
  const sum = summarize(all, null, now);
  const today = now.slice(0, 10);
  const swipe = useSwipe((dir) => setDay(dayKey(addWeeks(date, dir))));

  const openDay = (k: string) => {
    setDay(k);
    updateSettings({ calendarView: 'day' });
  };

  return (
    <div className="view-anim" {...swipe}>
      <SummaryCard
        title={`Тиждень ${fmt(start, 'd MMM')} – ${fmt(addDays(start, 6), 'd MMM')}`}
        count={sum.done + sum.planned}
        earned={sum.earned}
        expected={sum.expected}
        cancelled={sum.cancelled}
        moved={sum.moved}
      />
      <div className="week-grid" style={{ marginTop: 14 }}>
        <div />
        {days.map((d) => {
          const k = dayKey(d);
          const v = (byDay.get(k) ?? []).reduce((s, l) => s + lessonValue(l), 0);
          return (
            <button key={k} className="wk-head" data-today={k === today ? '' : undefined} onClick={() => openDay(k)}>
              <span className="ws-wd">{weekdayShort(isoWeekday(d))}</span>
              <span className="ws-num">{d.getDate()}</span>
              <span className="sum">{v > 0 ? tiny(v) : '·'}</span>
            </button>
          );
        })}
        <div className="wk-gutter" style={{ height }}>
          {Array.from({ length: endH - startH }, (_, i) => startH + i).map((h) => (
            <span key={h} style={{ top: top(h * 60) }}>
              {pad(h)}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const k = dayKey(d);
          return (
            <div
              key={k}
              className="wk-col"
              data-today={k === today ? '' : undefined}
              style={{ height }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const min = Math.round((startH * 60 + (y / WHOUR) * 60) / 30) * 30;
                open({ kind: 'newLesson', start: `${k}T${hhmm(Math.min(min, 23 * 60 + 30))}` });
              }}
            >
              {Array.from({ length: endH - startH }, (_, i) => (
                <div key={i} className="wk-line" style={{ top: i * WHOUR }} />
              ))}
              {k === today && minutesOf(now) >= startH * 60 && minutesOf(now) <= endH * 60 && (
                <div className="tl-now" style={{ top: top(minutesOf(now)), left: 0 }} />
              )}
              {layout(byDay.get(k) ?? []).map(({ l, s, col, cols }) => (
                <LessonBlock
                  key={l.id}
                  lesson={l}
                  now={now}
                  narrow
                  style={{
                    top: top(s) + 1,
                    height: Math.max(22, (l.duration / 60) * WHOUR - 2),
                    left: cols > 1 ? `calc(${(col / cols) * 100}% + 1px)` : undefined,
                    width: cols > 1 ? `calc(${100 / cols}% - 2px)` : undefined,
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  count,
  earned,
  expected,
  cancelled,
  moved,
}: {
  title: string;
  count: number;
  earned: number;
  expected: number;
  cancelled: number;
  moved: number;
}) {
  return (
    <div className="card day-summary" style={{ marginBottom: 0 }}>
      <div className="ds-top">
        <div>
          <div className="ds-date">{title}</div>
          <div className="ds-main">{count ? nPlural(count, LESSONS) : 'Немає уроків'}</div>
        </div>
        {earned + expected > 0 && (
          <div className="ds-money">
            <div className="big">{money(earned + expected)}</div>
            <div className="small">зароблено {money(earned)}</div>
          </div>
        )}
      </div>
      {(cancelled > 0 || moved > 0) && (
        <div className="faint" style={{ fontSize: 13, fontWeight: 650, marginTop: -4 }}>
          {cancelled > 0 && `Скасовано ${cancelled}`}
          {cancelled > 0 && moved > 0 && ' · '}
          {moved > 0 && `перенесено ${moved}`}
        </div>
      )}
    </div>
  );
}

/* ---------- Month ---------- */

function MonthView({ date, byDay, now }: { date: Date; byDay: Map<string, Lesson[]>; now: string }) {
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const rec = useData((s) => s.lessons);
  const updateSettings = useData((s) => s.updateSettings);
  const setDay = useUi((s) => s.setDay);
  const ms = startOfMonth(date);
  const me = endOfMonth(date);
  const days = eachDayOfInterval({ start: startOfWeek(ms, WEEK_OPTS), end: endOfWeek(me, WEEK_OPTS) });
  const sum = summarize(liveLessons(rec), { from: dayKey(ms), to: dayKey(me) }, now);
  const today = now.slice(0, 10);
  const swipe = useSwipe((dir) => setDay(dayKey(addMonths(date, dir))));

  return (
    <div className="view-anim" {...swipe}>
      <div className="month-grid">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="mg-wd">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const ls = byDay.get(k) ?? [];
          const v = ls.reduce((s, l) => s + lessonValue(l), 0);
          return (
            <button
              key={k}
              className="mg-day"
              data-out={isSameMonth(d, date) ? undefined : ''}
              data-today={k === today ? '' : undefined}
              onClick={() => {
                setDay(k);
                updateSettings({ calendarView: 'day' });
              }}
              aria-label={`${fmt(d, 'd MMMM')}: ${nPlural(ls.length, LESSONS)}`}
            >
              <span className="mg-num">{d.getDate()}</span>
              <span className="mg-dots">
                {ls.slice(0, 9).map((l) => (
                  <i
                    key={l.id}
                    data-cancelled={l.status === 'cancelled' ? '' : undefined}
                    style={{ '--c': lessonColor(l, students, groups) } as CSSProperties}
                  />
                ))}
              </span>
              {v > 0 && <span className="mg-sum">{tiny(v)}</span>}
            </button>
          );
        })}
      </div>

      <div className="tiles four" style={{ marginTop: 16 }}>
        <Tile label="Уроків" value={sum.done + sum.planned} sub={`проведено ${sum.done}${sum.trials ? ` · пробних ${sum.trials}` : ''}`} />
        <Tile label="Дохід" value={<Money value={sum.earned + sum.expected} />} sub={`зароблено ${money(sum.earned)}`} />
        <Tile
          label="Скасовано"
          value={sum.cancelled}
          sub={sum.cancelled ? `учнями ${sum.cancelledByStudent} · мною ${sum.cancelledByTeacher}` : 'без скасувань'}
        />
        <Tile label="Перенесено" value={sum.moved} sub={sum.moved ? 'на інший день чи час' : 'без перенесень'} />
      </div>
    </div>
  );
}
