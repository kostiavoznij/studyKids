import { ChevronLeft, ChevronRight, CircleAlert, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useAccess } from '../data/access';
import { dayOffLabel } from '../data/constants';
import { lessonsOfStudent, useDaysOff, useLiveLessons, useLivePayments, useLiveStudents, useReceived } from '../data/selectors';
import { useAccounts } from '../data/billing';
import {
  ahead,
  daysOffStats,
  deltaPct,
  hoursTaught,
  insights,
  monthSeries,
  received,
  recordsStart,
  sameStretch,
  summarize,
  trialConversion,
  weekdayLoad,
  type DayOffStat,
} from '../data/stats';
import { useData } from '../data/store';
import { fmt, periodLabel, periodRange, shiftPeriod, WEEKDAYS_SHORT, type Period, type Range } from '../lib/dates';
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
const SAME_LABEL: Record<Period, string> = {
  week: 'до того ж часу минулого тижня',
  month: 'до того ж часу минулого місяця',
  year: 'до того ж часу минулого року',
};

export function StatsScreen() {
  const lessons = useLiveLessons();
  const students = useLiveStudents();
  const rec = useData((s) => s.lessons);
  const studentsRec = useData((s) => s.students);
  const payments = useLivePayments();
  const daysOff = useDaysOff();
  const workDays = useData((s) => s.settings.workDays);
  const accounts = useAccounts();
  const finance = useAccess().finance;
  const now = useNow();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [metric, setMetric] = useState<'earned' | 'received'>('earned');

  const cur = periodRange(period, anchor);
  const prev = periodRange(period, shiftPeriod(period, anchor, -1));
  const a = summarize(lessons, cur, now);
  const notes = insights(lessons, students, cur, prev, now);
  // Facts are compared with the same stretch of the previous period, and only once there are records for it.
  const start = recordsStart(lessons);
  const stretch = sameStretch(cur, prev, now.slice(0, 10));
  const cmpLabel = stretch.to !== prev.to ? SAME_LABEL[period] : PREV_LABEL[period];
  const comparable = !!start && start <= stretch.from;
  const b = summarize(lessons, stretch, now);
  const next = ahead(lessons, cur, now);
  const since = start && cur.from < start ? `записи з ${fmt(start, 'd MMMM yyyy')}` : '';
  // Differences with the bank she accepted belong to whole months, so a week goes without them.
  const { records, money: banked } = useReceived();
  const correction = (m: string) => (banked.get(m) ?? 0) - (records.get(m) ?? 0);
  const inflowOf = (r: Range) => {
    const x = received(payments, r);
    if (period !== 'week') for (const m of banked.keys()) if (m >= r.from.slice(0, 7) && m <= r.to.slice(0, 7)) x.amount += correction(m);
    return x;
  };
  const inflow = inflowOf(cur);
  const inflowPrev = inflowOf(stretch);
  const conv = trialConversion(lessons, studentsRec, cur);
  const offNow = daysOffStats(daysOff, lessons, cur, workDays);
  const offBefore = daysOffStats(daysOff, lessons, prev, workDays);

  // Money held in advance and money owed, right now, across all families.
  let prepaid = 0;
  let owed = 0;
  for (const acc of accounts.values()) {
    for (const x of acc.pots) {
      if (x.balance > 0) prepaid += x.balance;
      else owed += -x.balance;
    }
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
    .filter((r) => r.x.total > 0 || r.y.done > 0);
  // By what already happened: money earned, or (without money) lessons taught.
  const weight = (x: (typeof rows)[number]['x']) => (finance ? x.earned : x.done);
  rows.sort((p, q) => weight(q.x) - weight(p.x));
  const maxIncome = Math.max(1, ...rows.map((r) => weight(r.x)));

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1 style={{ flex: 1 }}>Статистика</h1>
          <button className="link-btn" onClick={() => navigate('/stats/teachers')}>
            По вчительках
          </button>
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

        {!finance && (
          <div className="hero-card rise">
            <div className="hero-label">Проведено уроків</div>
            <div className="hero-value">{a.done}</div>
            <div className="hero-sub">
              {hoursTaught(lessons, cur).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} год
              {a.unmarked > 0 && ` · ще не відмічено ${a.unmarked}`}
              {since && ` · ${since}`}
            </div>
            <div className="hero-foot">
              {comparable && b.done > 0 ? <Delta pct={deltaPct(a.done, b.done)} suffix={cmpLabel} /> : <span className="faint">порівнювати ще немає з чим</span>}
            </div>
            {next.count > 0 && (
              <div className="hero-money">
                <span>
                  ще за розкладом <b>{nPlural(next.count, LESSONS)}</b>
                  {next.until < cur.to && ` (календар заповнено до ${fmt(next.until, 'd MMMM')})`}
                </span>
              </div>
            )}
          </div>
        )}

        {finance && <div className="hero-card rise">
          <div className="hero-label">Зароблено за проведені уроки</div>
          <div className="hero-value">{money(a.earned)}</div>
          <div className="hero-sub">
            за {nPlural(a.done, LESSONS)}
            {a.unmarked > 0 && ` · ще не відмічено ${a.unmarked}`}
            {since && ` · ${since}`}
          </div>
          <div className="hero-foot">
            {comparable && b.earned > 0 ? (
              <Delta pct={deltaPct(a.earned, b.earned)} suffix={cmpLabel} />
            ) : (
              <span className="faint">порівнювати ще немає з чим</span>
            )}
          </div>
          <div className="hero-money">
            {next.count > 0 && (
              <span>
                ще за розкладом <b>{nPlural(next.count, LESSONS)}</b> на <b>{money(next.amount)}</b>
                {next.until < cur.to && ` (календар заповнено до ${fmt(next.until, 'd MMMM')})`}
              </span>
            )}
            <span>
              надійшло на рахунок <b>{money(inflow.amount)}</b>
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
          {Math.abs(inflow.amount - a.earned) >= 1 && (
            <button className="hero-note" onClick={() => navigate('/finance')}>
              <span>
                {inflow.amount > a.earned
                  ? `Надійшло на ${money(inflow.amount - a.earned)} більше, ніж зароблено за проведені уроки: здебільшого це передоплата за уроки, які ще попереду.`
                  : `Надійшло на ${money(a.earned - inflow.amount)} менше, ніж зароблено за проведені уроки: частину з них оплатили раніше або ще не оплатили.`}{' '}
                <b>Детальніше у Фінансах</b>
              </span>
              <ChevronRight size={18} />
            </button>
          )}
        </div>}

        <div className="tiles four" style={{ marginTop: 12 }}>
          {finance ? (
            <Tile
              label="Проведено уроків"
              value={a.done}
              sub={
                <>
                  {comparable && b.done > 0 && <Delta pct={deltaPct(a.done, b.done)} />} {next.count > 0 ? `+ ${next.count} за розкладом` : ''}
                </>
              }
            />
          ) : (
            <Tile label="Учнів на уроках" value={a.students} sub={comparable && b.students ? `було ${b.students}` : '—'} />
          )}
          {finance ? (
            <Tile
              label="Надійшло на рахунок"
              value={<Money value={inflow.amount} />}
              sub={comparable && inflowPrev.amount ? <Delta pct={deltaPct(inflow.amount, inflowPrev.amount)} /> : `${inflow.count} оплат`}
            />
          ) : (
            <Tile label="Уроків з темою" value={a.topics} sub={a.done ? `з ${a.done} проведених` : '—'} />
          )}
          <Tile label="Пробні уроки" value={a.trials} sub={conv.trials ? `стали учнями: ${conv.converted} з ${conv.trials}` : 'знайомство з новими учнями'} />
          {finance && <Tile label="Учнів на уроках" value={a.students} sub={comparable && b.students ? `було ${b.students}` : '—'} />}
          <Tile label="Скасовано" value={a.cancelled} sub={a.cancelled ? `учнями ${a.cancelledByStudent} · вчителькою ${a.cancelledByTeacher}` : 'без скасувань'} />
          <Tile label="Перенесено" value={a.moved} sub={comparable && b.moved ? `було ${b.moved}` : 'на інший час'} />
          {finance && <Tile label="Середня ціна уроку" value={a.avgPrice ? <Money value={a.avgPrice} /> : '—'} sub="за проведений урок" />}
          <Tile label="Засвоєння" value={a.avgGrade != null ? `${grade1(a.avgGrade)} з 5` : '—'} sub={comparable && b.avgGrade != null ? `було ${grade1(b.avgGrade)}` : 'середня оцінка'} />
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
        <DaysOffCard now={offNow} before={offBefore} period={period} finance={finance} />

        <div className="stats-charts">
          {!finance && (
            <div className="card">
              <div className="card-title">
                <h3>Проведено уроків по місяцях</h3>
              </div>
              <ColumnChart
                label="Проведені уроки по місяцях"
                data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p.done, highlight: p.current }))}
                format={(v) => String(v)}
              />
            </div>
          )}
          {finance && <div className="card">
            <div className="card-title">
              <h3>{metric === 'earned' ? 'Зароблено' : 'Надійшло на рахунок'} по місяцях</h3>
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
              label={metric === 'earned' ? 'Зароблено по місяцях' : 'Надійшло на рахунок по місяцях'}
              data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p[metric] + (metric === 'received' ? correction(p.key) : 0), highlight: p.current }))}
              format={(v) => money(v)}
              tickFormat={compact}
            />
          </div>}

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
                    <span className="rank-money">{finance ? money(x.earned) : nPlural(x.done, LESSONS)}</span>
                  </div>
                  <div className="rank-bar">
                    <span style={{ width: `${(weight(x) / maxIncome) * 100}%` }} />
                  </div>
                  <div className="list-sub">
                    {finance ? nPlural(x.done, LESSONS) : `проведено ${x.done}`}
                    {x.planned > 0 && ` + ${x.planned} заплановано`}
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

function DaysOffCard({ now, before, period, finance }: { now: DayOffStat[]; before: DayOffStat[]; period: Period; finance: boolean }) {
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
                {x.lessons > 0 && `скасовано ${nPlural(x.lessons, LESSONS)}${finance && x.amount > 0 ? ` · ${money(x.amount)}` : ''} · `}
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
