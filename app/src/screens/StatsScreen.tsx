import { ChevronLeft, ChevronRight, CircleAlert, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { dayOffLabel } from '../data/constants';
import { lessonsOfStudent, useDaysOff, useLiveLessons, useLivePayments, useLiveStudents } from '../data/selectors';
import { useAccounts } from '../data/billing';
import { daysOffStats, deltaPct, insights, monthSeries, received, summarize, trialConversion, weekdayLoad, type DayOffStat } from '../data/stats';
import { useData } from '../data/store';
import { periodLabel, periodRange, shiftPeriod, WEEKDAYS_SHORT, type Period } from '../lib/dates';
import { compact, DAYS, grade1, LESSONS, money, nPlural } from '../lib/format';
import { ColumnChart } from '../ui/charts';
import { Avatar, Delta, Empty, Money, Segmented, Tile, useNow } from '../ui/components';
import { navigate } from '../ui/router';
import { DAY_OFF_ICONS } from './DayOffSheet';

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
  const studentsRec = useData((s) => s.students);
  const payments = useLivePayments();
  const daysOff = useDaysOff();
  const workDays = useData((s) => s.settings.workDays);
  const accounts = useAccounts();
  const now = useNow();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [metric, setMetric] = useState<'earned' | 'received'>('earned');

  const cur = periodRange(period, anchor);
  const prev = periodRange(period, shiftPeriod(period, anchor, -1));
  const a = summarize(lessons, cur, now);
  const b = summarize(lessons, prev, now);
  const projected = a.earned + a.expected;
  const incomeDelta = deltaPct(projected, b.earned);
  const notes = insights(lessons, students, cur, prev, now);
  const inflow = received(payments, cur);
  const inflowPrev = received(payments, prev);
  const conv = trialConversion(lessons, studentsRec, cur);
  const offNow = daysOffStats(daysOff, lessons, cur, workDays);
  const offBefore = daysOffStats(daysOff, lessons, prev, workDays);

  // Money held in advance and money owed, right now, across all families.
  let prepaid = 0;
  let owed = 0;
  for (const acc of accounts.values()) {
    if (acc.balance > 0) prepaid += acc.balance;
    else owed += -acc.balance;
  }

  const series =
    period === 'year'
      ? monthSeries(lessons, payments, new Date(anchor.getFullYear(), 11, 1), 12, now)
      : monthSeries(lessons, payments, anchor, 12, now);
  const load = weekdayLoad(lessons, cur);

  const rows = students
    .map((st) => {
      const ls = lessonsOfStudent(rec, st.id);
      const x = summarize(ls, cur, now, st.id);
      const y = summarize(ls, prev, now, st.id);
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
          <div className="hero-label">Дохід за проведені уроки</div>
          <div className="hero-value">{money(projected)}</div>
          <div className="hero-sub">
            {a.expected > 0 ? (
              <>
                зароблено {money(a.earned)} · ще заплановано {money(a.expected)}
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
          </div>
          <div className="hero-money">
            <span>
              надійшло оплат <b>{money(inflow.amount)}</b>
            </span>
            <span>
              передоплата зараз <b>{money(prepaid)}</b>
            </span>
            {owed > 0.5 && (
              <span className="bad">
                борги <b>{money(owed)}</b>
              </span>
            )}
          </div>
        </div>

        <div className="tiles four" style={{ marginTop: 12 }}>
          <Tile label="Проведено уроків" value={a.done} sub={<><Delta pct={deltaPct(a.done + a.planned, b.done)} /> {a.planned > 0 ? `+ ${a.planned} попереду` : ''}</>} />
          <Tile label="Надійшло оплат" value={<Money value={inflow.amount} />} sub={inflowPrev.amount ? <Delta pct={deltaPct(inflow.amount, inflowPrev.amount)} /> : `${inflow.count} оплат`} />
          <Tile label="Пробні уроки" value={a.trials} sub={conv.trials ? `стали учнями: ${conv.converted} з ${conv.trials}` : 'знайомство з новими учнями'} />
          <Tile label="Учнів на уроках" value={a.students} sub={b.students ? `було ${b.students}` : '—'} />
          <Tile label="Скасовано" value={a.cancelled} sub={a.cancelled ? `учнями ${a.cancelledByStudent} · мною ${a.cancelledByTeacher}` : 'без скасувань'} />
          <Tile label="Перенесено" value={a.moved} sub={b.moved ? `було ${b.moved}` : 'на інший час'} />
          <Tile label="Середня ціна уроку" value={a.avgPrice ? <Money value={a.avgPrice} /> : '—'} sub="за проведений урок" />
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

        <div className="section-title">
          <h2>Дні без уроків</h2>
          <span className="faint" style={{ fontSize: 13 }}>
            {periodLabel(period, anchor)}
          </span>
        </div>
        <DaysOffCard now={offNow} before={offBefore} period={period} />

        <div className="stats-charts">
          <div className="card">
            <div className="card-title">
              <h3>{metric === 'earned' ? 'Зароблено' : 'Надійшло оплат'} по місяцях</h3>
              <div className="seg seg-sm">
                <button aria-pressed={metric === 'earned'} onClick={() => setMetric('earned')}>
                  Уроки
                </button>
                <button aria-pressed={metric === 'received'} onClick={() => setMetric('received')}>
                  Оплати
                </button>
              </div>
            </div>
            <ColumnChart
              label={metric === 'earned' ? 'Зароблено по місяцях' : 'Надійшло оплат по місяцях'}
              data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p[metric], highlight: p.current }))}
              format={(v) => money(v)}
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
                    <span className="rank-money">{money(x.earned + x.expected)}</span>
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

function DaysOffCard({ now, before, period }: { now: DayOffStat[]; before: DayOffStat[]; period: Period }) {
  const sick = now.find((x) => x.kind === 'sick');
  const rows = sick ? now : [{ kind: 'sick' as const, days: 0, lessons: 0, amount: 0 }, ...now];
  if (now.length === 0 && before.length === 0) {
    return (
      <div className="card faint" style={{ fontSize: 14 }}>
        Лікарняних, відпусток і свят у цьому періоді не позначено. Позначити день можна в календарі — у зведенні дня кнопка «Позначити день».
      </div>
    );
  }
  return (
    <div className="list">
      {rows.map((x) => {
        const Icon = DAY_OFF_ICONS[x.kind];
        const was = before.find((b) => b.kind === x.kind)?.days ?? 0;
        return (
          <div key={x.kind} className="list-item dayoff-stat" data-kind={x.kind}>
            <span className="insight-icon">
              <Icon size={18} />
            </span>
            <div className="list-main">
              <div className="list-title">{dayOffLabel(x.kind)}</div>
              <div className="list-sub" style={{ whiteSpace: 'normal' }}>
                {x.lessons > 0 && `скасовано ${nPlural(x.lessons, LESSONS)}${x.amount > 0 ? ` · ${money(x.amount)}` : ''} · `}
                {`${PREV_SHORT[period]}: ${was ? nPlural(was, DAYS) : 'не було'}`}
              </div>
            </div>
            <div className="list-end dayoff-days">{x.days ? nPlural(x.days, DAYS) : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

const PREV_SHORT: Record<Period, string> = { week: 'минулого тижня', month: 'минулого місяця', year: 'минулого року' };
