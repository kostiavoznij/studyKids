import { ChevronLeft, ChevronRight, GraduationCap } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useAccess } from '../data/access';
import { colorHex } from '../data/constants';
import { useLiveLessons, useLivePayments, useTeachers } from '../data/selectors';
import {
  ahead,
  hoursTaught,
  monthSeries,
  paymentTeacher,
  pupilsOf,
  received,
  recordsStart,
  summarize,
  trialConversion,
  type Summary,
} from '../data/stats';
import { useData } from '../data/store';
import { teacherOf } from '../data/teachers';
import type { ID, Lesson, Teacher } from '../data/types';
import { fmt, inRange, periodLabel, periodRange, shiftPeriod, type Period, type Range } from '../lib/dates';
import { compact, grade1, LESSONS, money, nPlural, STUDENTS } from '../lib/format';
import { ColumnChart } from '../ui/charts';
import { Avatar, Empty, Segmented, Tile, useNow } from '../ui/components';
import { navigate } from '../ui/router';

/*
 * Statistics per teacher, apart from the main statistics so that day-to-day
 * work looks the same as before there were teachers. Money is what lessons
 * earned (by the lesson's teacher) — facts only; what the calendar still has
 * planned is shown separately as such. Managers see the same without money.
 */

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'year', label: 'Рік' },
];

const hours = (h: number) => `${h.toLocaleString('uk-UA', { maximumFractionDigits: 1 })} год`;

interface Row {
  teacher: Teacher;
  lessons: Lesson[];
  cur: Summary;
  prev: Summary;
  hours: number;
  /** students given to her now and taking lessons */
  active: number;
  /** payments in the period from families whose money goes to her */
  paid: number;
}

export function TeacherStatsScreen({ teacherId }: { teacherId?: ID }) {
  const finance = useAccess().finance;
  const teachers = useTeachers();
  const lessons = useLiveLessons();
  const payments = useLivePayments();
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const now = useNow();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(() => new Date());

  const cur = periodRange(period, anchor);
  const prev = periodRange(period, shiftPeriod(period, anchor, -1));
  const start = recordsStart(lessons);
  // Before the records began there's nothing to compare with.
  const comparable = !!start && prev.to >= start;

  const rows = useMemo<Row[]>(() => {
    const byTeacher = new Map<ID, Lesson[]>();
    for (const l of lessons) {
      const id = teacherOf(l);
      const arr = byTeacher.get(id);
      if (arr) arr.push(l);
      else byTeacher.set(id, [l]);
    }
    const paidBy = new Map<ID, number>();
    for (const p of payments) {
      if (p.opening || !inRange(p.date, cur)) continue;
      const id = paymentTeacher(p, students, groups);
      paidBy.set(id, (paidBy.get(id) ?? 0) + p.amount);
    }
    return teachers
      .map((teacher) => {
        const ls = byTeacher.get(teacher.id) ?? [];
        return {
          teacher,
          lessons: ls,
          cur: summarize(ls, cur, now),
          prev: summarize(ls, prev, now),
          hours: hoursTaught(ls, cur),
          active: Object.values(students).filter((s) => !s.deletedAt && s.status === 'active' && teacherOf(s) === teacher.id).length,
          paid: paidBy.get(teacher.id) ?? 0,
        };
      })
      // An archived teacher shows up only for periods she taught in.
      .filter((r) => r.teacher.status === 'active' || r.cur.total > 0);
  }, [teachers, lessons, payments, students, groups, cur.from, cur.to, prev.from, prev.to, now]);

  const selected = rows.find((r) => r.teacher.id === teacherId);

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <button className="icon-btn" onClick={() => navigate('/stats')} aria-label="До статистики">
            <ChevronLeft size={24} />
          </button>
          <h1 style={{ flex: 1 }}>Статистика вчительок</h1>
        </div>

        <div className="stats-toolbar">
          <Segmented
            label="Період"
            value={period}
            options={PERIODS}
            onChange={(p) => {
              setPeriod(p);
              setAnchor(new Date());
            }}
          />
          <div className="period-nav">
            <button className="icon-btn" onClick={() => setAnchor(shiftPeriod(period, anchor, -1))} aria-label="Попередній період">
              <ChevronLeft size={20} />
            </button>
            <span>{periodLabel(period, anchor)}</span>
            <button className="icon-btn" onClick={() => setAnchor(shiftPeriod(period, anchor, 1))} aria-label="Наступний період">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="chips teacher-filter" role="group" aria-label="Чия статистика">
          <button className="chip sm" aria-pressed={!selected} onClick={() => navigate('/stats/teachers')}>
            Усі
          </button>
          {rows.map((r) => (
            <button key={r.teacher.id} className="chip sm" aria-pressed={selected === r} onClick={() => navigate(`/stats/teachers/${r.teacher.id}`)}>
              <i className="dot" style={{ '--c': colorHex(r.teacher.color) } as CSSProperties} />
              {r.teacher.name}
            </button>
          ))}
        </div>

        {start && cur.to < start ? (
          <Empty icon={<GraduationCap size={36} />} title="За цей період записів немає">
            Записи ведуться з {fmt(start, 'd MMMM yyyy')}.
          </Empty>
        ) : selected ? (
          <TeacherDetail row={selected} cur={cur} anchor={anchor} comparable={comparable} finance={finance} />
        ) : (
          <School rows={rows} lessons={lessons} cur={cur} prev={prev} comparable={comparable} finance={finance} />
        )}

        {start && (
          <p className="faint" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 18 }}>
            Записи ведуться з {fmt(start, 'd MMMM yyyy')}. Зароблено — за уроки, які вже відбулися; «ще за розкладом» — те, що стоїть у календарі до кінця
            періоду.
          </p>
        )}
      </div>
    </div>
  );
}

/** Fact first; what's still planned goes underneath, labelled as such. */
function Hero({
  label,
  sum,
  lessons,
  cur,
  hoursValue,
  prev,
  comparable,
  finance,
}: {
  label: string;
  sum: Summary;
  lessons: Lesson[];
  cur: Range;
  hoursValue: number;
  prev: Summary;
  comparable: boolean;
  finance: boolean;
}) {
  const now = useNow();
  const next = ahead(lessons, cur, now);
  return (
    <div className="hero-card rise">
      <div className="hero-label">{finance ? `${label}: зароблено за проведені уроки` : `${label}: проведено уроків`}</div>
      <div className="hero-value">{finance ? money(sum.earned) : sum.done}</div>
      <div className="hero-sub">
        {finance && `${nPlural(sum.done, LESSONS)} · `}
        {hours(hoursValue)} · {nPlural(sum.students, STUDENTS)} на уроках
        {sum.unmarked > 0 && ` · не відмічено ${sum.unmarked}`}
      </div>
      <div className="hero-foot">
        {comparable && prev.done > 0 ? (
          <span className="faint">
            минулого періоду: {finance ? `${money(prev.earned)} за ${nPlural(prev.done, LESSONS)}` : nPlural(prev.done, LESSONS)}
          </span>
        ) : (
          <span className="faint">порівнювати ще немає з чим</span>
        )}
      </div>
      {next.count > 0 && (
        <div className="hero-money">
          <span>
            ще за розкладом: <b>{nPlural(next.count, LESSONS)}</b>
            {finance && next.amount > 0 && (
              <>
                {' '}
                на <b>{money(next.amount)}</b>
              </>
            )}
            {next.until < cur.to && ` (календар заповнено до ${fmt(next.until, 'd MMMM')})`}
          </span>
        </div>
      )}
    </div>
  );
}

function School({
  rows,
  lessons,
  cur,
  prev,
  comparable,
  finance,
}: {
  rows: Row[];
  lessons: Lesson[];
  cur: Range;
  prev: Range;
  comparable: boolean;
  finance: boolean;
}) {
  const now = useNow();
  const payments = useLivePayments();
  const a = summarize(lessons, cur, now);
  const b = summarize(lessons, prev, now);
  const weight = (r: Row) => (finance ? r.cur.earned : r.cur.done);
  const sorted = [...rows].sort((x, y) => weight(y) - weight(x));
  const max = Math.max(1, ...sorted.map(weight));
  const inflow = received(payments, cur);

  return (
    <>
      <Hero label="Уся школа" sum={a} lessons={lessons} cur={cur} hoursValue={hoursTaught(lessons, cur)} prev={b} comparable={comparable} finance={finance} />

      <div className="tiles four" style={{ marginTop: 12 }}>
        <Tile label="Вчительок працювало" value={rows.filter((r) => r.cur.done > 0).length} sub={`з ${rows.length}`} />
        <Tile label="Учнів на уроках" value={a.students} sub={comparable && b.students ? `було ${b.students}` : '—'} />
        {finance && <Tile label="Середня ціна уроку" value={a.avgPrice ? money(a.avgPrice) : '—'} sub="за проведений урок" />}
        {finance && <Tile label="Надійшло на рахунок" value={money(inflow.amount)} sub={`${inflow.count} оплат`} />}
      </div>

      <div className="section-title">
        <h2>Вчительки</h2>
        <span className="faint" style={{ fontSize: 13 }}>
          {finance ? 'за заробленим' : 'за уроками'}
        </span>
      </div>
      <div className="list">
        {sorted.map((r) => (
          <button key={r.teacher.id} className="list-item rank-row" onClick={() => navigate(`/stats/teachers/${r.teacher.id}`)}>
            <Avatar name={r.teacher.name} color={r.teacher.color} size={38} />
            <div className="list-main">
              <div className="rank-top">
                <span className="list-title">{r.teacher.name}</span>
                <span className="rank-money">{finance ? money(r.cur.earned) : nPlural(r.cur.done, LESSONS)}</span>
              </div>
              <div className="rank-bar">
                <span style={{ width: `${(weight(r) / max) * 100}%`, background: colorHex(r.teacher.color) }} />
              </div>
              <div className="list-sub" style={{ whiteSpace: 'normal' }}>
                {finance && `${nPlural(r.cur.done, LESSONS)} · `}
                {hours(r.hours)} · {nPlural(r.cur.students, STUDENTS)}
                {finance && r.cur.avgPrice > 0 && ` · у середньому ${money(r.cur.avgPrice)}`}
                {r.cur.cancelled > 0 && ` · скасовано ${r.cur.cancelled}`}
                {r.teacher.status === 'archived' && ' · в архіві'}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function TeacherDetail({ row, cur, anchor, comparable, finance }: { row: Row; cur: Range; anchor: Date; comparable: boolean; finance: boolean }) {
  const now = useNow();
  const students = useData((s) => s.students);
  const payments = useLivePayments();
  const { teacher, lessons, cur: a, prev: b } = row;
  const pupils = pupilsOf(lessons, payments, cur, now);
  const conv = trialConversion(lessons, students, cur);
  const series = monthSeries(lessons, [], anchor, 6, now);

  return (
    <>
      <Hero label={teacher.name} sum={a} lessons={lessons} cur={cur} hoursValue={row.hours} prev={b} comparable={comparable} finance={finance} />

      <div className="tiles four" style={{ marginTop: 12 }}>
        <Tile label="Учнів веде зараз" value={row.active} sub={`на уроках за період: ${a.students}`} />
        {finance && <Tile label="Середня ціна уроку" value={a.avgPrice ? money(a.avgPrice) : '—'} sub="за проведений урок" />}
        {finance && <Tile label="Оплати від її учнів" value={money(row.paid)} sub="учні, яких вона веде зараз" />}
        <Tile
          label="Скасовано"
          value={a.cancelled}
          sub={a.cancelled ? `учнями ${a.cancelledByStudent} · вчителькою ${a.cancelledByTeacher}` : 'без скасувань'}
        />
        <Tile label="Пробні уроки" value={a.trials} sub={conv.trials ? `стали учнями: ${conv.converted} з ${conv.trials}` : '—'} />
        <Tile label="Засвоєння" value={a.avgGrade != null ? `${grade1(a.avgGrade)} з 5` : '—'} sub={comparable && b.avgGrade != null ? `було ${grade1(b.avgGrade)}` : 'середня оцінка'} />
        <Tile label="Уроків з темою" value={a.topics} sub={a.done ? `з ${a.done} проведених` : '—'} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          <h3>{finance ? 'Зароблено по місяцях' : 'Проведено уроків по місяцях'}</h3>
        </div>
        <ColumnChart
          label={finance ? 'Зароблено по місяцях' : 'Проведені уроки по місяцях'}
          data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: finance ? p.earned : p.done, highlight: p.current }))}
          format={(v) => (finance ? money(v) : String(v))}
          tickFormat={finance ? compact : undefined}
          height={170}
        />
      </div>

      <div className="section-title">
        <h2>Її учні за період</h2>
      </div>
      {pupils.length === 0 ? (
        <Empty title="Уроків за цей період немає" />
      ) : (
        <div className="list">
          {pupils.map((p) => {
            const st = students[p.studentId];
            return (
              <button key={p.studentId} className="list-item" onClick={() => navigate(`/students/${p.studentId}`)}>
                <Avatar name={st?.name ?? '—'} color={st?.color ?? 'violet'} size={36} />
                <div className="list-main">
                  <div className="list-title">{st?.name ?? 'Видалений учень'}</div>
                  <div className="list-sub" style={{ whiteSpace: 'normal' }}>
                    {nPlural(p.done, LESSONS)}
                    {p.planned > 0 && ` + ${p.planned} попереду`}
                    {finance && p.price > 0 && ` · ${money(p.price)} за урок`}
                    {finance && p.paid > 0 && ` · оплатили ${money(p.paid)}`}
                    {p.avgGrade != null && ` · засвоєння ${grade1(p.avgGrade)}`}
                  </div>
                </div>
                {finance && (
                  <div className="list-end">
                    <div style={{ fontWeight: 750 }}>{money(p.earned)}</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      зароблено
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
