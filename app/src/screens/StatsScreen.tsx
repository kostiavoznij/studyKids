import { ChevronLeft, ChevronRight, CircleAlert, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { lessonsOfStudent, useLiveLessons, useLiveStudents } from '../data/selectors';
import { deltaPct, insights, monthSeries, summarize, weekdayLoad } from '../data/stats';
import { useData } from '../data/store';
import { periodLabel, periodRange, shiftPeriod, WEEKDAYS_SHORT, type Period } from '../lib/dates';
import { compact, grade1, LESSONS, money, nPlural } from '../lib/format';
import { ColumnChart } from '../ui/charts';
import { Avatar, Delta, Empty, Money, Segmented, Tile, useNow } from '../ui/components';
import { navigate } from '../ui/router';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'year', label: 'Рік' },
];

const PREV_LABEL: Record<Period, string> = { week: 'до минулого тижня', month: 'до минулого місяця', year: 'до минулого року' };

export function StatsScreen() {
  const lessons = useLiveLessons();
  const students = useLiveStudents();
  const rec = useData((s) => s.lessons);
  const settings = useData((s) => s.settings);
  const now = useNow();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(() => new Date());

  const cur = periodRange(period, anchor);
  const prev = periodRange(period, shiftPeriod(period, anchor, -1));
  const a = summarize(lessons, settings, cur, now);
  const b = summarize(lessons, settings, prev, now);
  const projected = a.earned + a.expected;
  const incomeDelta = deltaPct(projected, b.earned);
  const notes = insights(lessons, students, settings, cur, prev, now);
  const base = settings.baseCurrency;

  const series =
    period === 'year'
      ? monthSeries(lessons, settings, new Date(anchor.getFullYear(), 11, 1), 12, now)
      : monthSeries(lessons, settings, anchor, 12, now);
  const load = weekdayLoad(lessons, cur);

  const rows = students
    .map((st) => {
      const ls = lessonsOfStudent(rec, st.id);
      const x = summarize(ls, settings, cur, now, st.id);
      const y = summarize(ls, settings, prev, now, st.id);
      return { st, x, y };
    })
    .filter((r) => r.x.total > 0 || r.y.done > 0)
    .sort((p, q) => q.x.earned + q.x.expected - (p.x.earned + p.x.expected));
  const maxIncome = Math.max(1, ...rows.map((r) => r.x.earned + r.x.expected));

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1>Статистика</h1>
        </div>

        <div className="stats-toolbar">
          <Segmented label="Період" value={period} options={PERIODS} onChange={(p) => { setPeriod(p); setAnchor(new Date()); }} />
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

        <div className="hero-card rise">
          <div className="hero-label">Дохід</div>
          <div className="hero-value">{money(projected, base)}</div>
          <div className="hero-sub">
            {a.expected > 0 ? (
              <>
                зароблено {money(a.earned, base)} · ще заплановано {money(a.expected, base)}
              </>
            ) : (
              <>за {nPlural(a.done, LESSONS)}</>
            )}
          </div>
          <div className="hero-foot">
            {incomeDelta != null ? (
              <Delta pct={incomeDelta} suffix={PREV_LABEL[period]} />
            ) : (
              <span className="faint">немає даних за попередній період</span>
            )}
            {a.unpaid > 0 && <span className="badge warn">не оплачено {money(a.unpaid, base)}</span>}
          </div>
        </div>

        <div className="tiles three" style={{ marginTop: 12 }}>
          <Tile label="Проведено уроків" value={a.done} sub={<><Delta pct={deltaPct(a.done + a.planned, b.done)} /> {a.planned > 0 ? `+ ${a.planned} попереду` : ''}</>} />
          <Tile label="Скасовано" value={a.cancelled} sub={a.cancelled ? `учнями ${a.cancelledByStudent} · мною ${a.cancelledByTeacher}` : 'без скасувань'} />
          <Tile label="Перенесено" value={a.moved} sub={b.moved ? `було ${b.moved}` : 'на інший час'} />
          <Tile label="Учнів на уроках" value={a.students} sub={b.students ? `було ${b.students}` : '—'} />
          <Tile label="Середня ціна уроку" value={a.avgPrice ? <Money value={a.avgPrice} /> : '—'} sub="з урахуванням валют" />
          <Tile label="Засвоєння" value={a.avgGrade != null ? `${grade1(a.avgGrade)} з 5` : '—'} sub={b.avgGrade != null ? `було ${grade1(b.avgGrade)}` : 'середня оцінка'} />
        </div>

        <div className="section-title">
          <h2>Що змінилось</h2>
          <span className="faint" style={{ fontSize: 13 }}>
            {PREV_LABEL[period]}
          </span>
        </div>
        {notes.length === 0 ? (
          <div className="card faint" style={{ fontSize: 14 }}>
            Усе рівно — помітних змін немає.
          </div>
        ) : (
          <div className="list">
            {notes.map((n, i) => (
              <button key={i} className="list-item insight" data-kind={n.kind} onClick={() => n.studentId && navigate(`/students/${n.studentId}`)}>
                <span className="insight-icon">
                  {n.kind === 'up' ? <TrendingUp size={18} /> : n.kind === 'down' ? <TrendingDown size={18} /> : n.kind === 'warn' ? <CircleAlert size={18} /> : <Info size={18} />}
                </span>
                <span className="list-main" style={{ fontWeight: 600, whiteSpace: 'normal' }}>
                  {n.text}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="stats-charts">
          <div className="card">
            <div className="card-title">
              <h3>Дохід по місяцях</h3>
              <span className="faint" style={{ fontSize: 13 }}>
                {period === 'year' ? anchor.getFullYear() : 'останні 12 місяців'}
              </span>
            </div>
            <ColumnChart
              label="Дохід по місяцях"
              data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p.earned, highlight: p.current }))}
              format={(v) => money(v, base)}
              tickFormat={compact}
            />
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Навантаження по днях</h3>
              <span className="faint" style={{ fontSize: 13 }}>
                уроків за період
              </span>
            </div>
            <ColumnChart
              label="Кількість уроків по днях тижня"
              data={load.map((v, i) => ({ key: String(i), label: WEEKDAYS_SHORT[i], title: WEEKDAYS_SHORT[i], value: v }))}
              format={(v) => String(v)}
              height={160}
            />
          </div>
        </div>

        <div className="section-title">
          <h2>Учні за період</h2>
        </div>
        {rows.length === 0 ? (
          <Empty title="За цей період уроків немає" />
        ) : (
          <div className="list">
            {rows.map(({ st, x, y }) => (
              <button key={st.id} className="list-item rank-row" onClick={() => navigate(`/students/${st.id}`)}>
                <Avatar name={st.name} color={st.color} size={38} />
                <div className="list-main">
                  <div className="rank-top">
                    <span className="list-title">{st.name}</span>
                    <span className="rank-money">{money(x.earned + x.expected, base)}</span>
                  </div>
                  <div className="rank-bar">
                    <span style={{ width: `${((x.earned + x.expected) / maxIncome) * 100}%` }} />
                  </div>
                  <div className="list-sub">
                    {nPlural(x.done + x.planned, LESSONS)}
                    {y.done > 0 && ` (було ${y.done})`}
                    {x.cancelled > 0 && ` · скасовано ${x.cancelled}`}
                    {x.avgGrade != null && ` · засвоєння ${grade1(x.avgGrade)}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
