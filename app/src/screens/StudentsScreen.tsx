import { parseISO } from 'date-fns';
import {
  CalendarPlus,
  ChevronLeft,
  CornerUpRight,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { accountLabel, useAccounts, type Account } from '../data/billing';
import { TRIAL_OUTCOMES, zoneLabel } from '../data/constants';
import { chargeOf, isTrial } from '../data/money';
import { lessonsOfStudent, livePayments, useLiveGroups, useLiveStudents } from '../data/selectors';
import { monthSeries, summarize } from '../data/stats';
import { useData } from '../data/store';
import type { Lesson, Student, StudentStatus } from '../data/types';
import {
  cap,
  endStamp,
  fmt,
  periodRange,
  shiftPeriod,
  shortDay,
  timeInZone,
  timeOf,
  weekdayShort,
  zoneDiffers,
} from '../lib/dates';
import { grade1, LESSONS, money, nPlural, plural, TOPICS } from '../lib/format';
import { ColumnChart, GradeLine, StackBar } from '../ui/charts';
import { Avatar, Delta, Empty, GradeMini, Money, Segmented, StatusBadge, Tile, useNow } from '../ui/components';
import { back, navigate } from '../ui/router';
import { useUi } from '../ui/uiStore';

/* ---------- List ---------- */

const STATUS_FILTERS: { value: StudentStatus; label: string }[] = [
  { value: 'active', label: 'Займаються' },
  { value: 'trial', label: 'Пробні' },
  { value: 'paused', label: 'Пауза' },
  { value: 'archived', label: 'Архів' },
];

export function StudentsScreen() {
  const students = useLiveStudents();
  const groups = useLiveGroups();
  const rec = useData((s) => s.lessons);
  const open = useUi((s) => s.open);
  const accounts = useAccounts();
  const now = useNow();
  const [filter, setFilter] = useState<StudentStatus>('active');
  const [q, setQ] = useState('');
  const month = periodRange('month', new Date());

  const count = (st: StudentStatus) => students.filter((s) => s.status === st).length;
  const list = students.filter((s) => s.status === filter && s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1>Учні</h1>
          <button className="btn btn-primary btn-sm" onClick={() => open({ kind: 'student' })}>
            <Plus size={17} /> Учень
          </button>
        </div>

        <div className="students-toolbar">
          <div className="search">
            <Search size={18} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук" aria-label="Пошук учня" />
          </div>
          <div className="chips status-chips" role="group" aria-label="Статус">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} className="chip sm" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label} <span className="chip-count">{count(f.value)}</span>
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <Empty icon={<UserRound size={36} />} title={q ? 'Нікого не знайдено' : 'Тут поки порожньо'}>
            {filter === 'active' && !q && (
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => open({ kind: 'student' })}>
                Додати учня
              </button>
            )}
          </Empty>
        ) : (
          <div className="student-grid">
            {list.map((s, i) => {
              const ls = lessonsOfStudent(rec, s.id);
              const m = summarize(ls, month, now, s.id);
              const a = accounts.get(s.id);
              const label = a && s.status === 'active' && a.state !== 'new' ? accountLabel(a, s) : null;
              return (
                <button key={s.id} className="student-card rise" style={{ animationDelay: `${i * 25}ms` }} onClick={() => navigate(`/students/${s.id}`)}>
                  <Avatar name={s.name} color={s.color} size={48} />
                  <div className="sc-main">
                    <div className="sc-name">{s.name}</div>
                    <div className="sc-sub">{[s.subject, s.grade].filter(Boolean).join(' · ')}</div>
                    {s.schedule.length > 0 && (
                      <div className="sc-slots">
                        {s.schedule.map((sl) => (
                          <span key={sl.id} className="badge">
                            {weekdayShort(sl.weekday)} {sl.time}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="sc-end">
                    <div className="sc-money">
                      <Money value={m.earned + m.expected} />
                    </div>
                    <div className="faint">{nPlural(m.done + m.planned, LESSONS)} за місяць</div>
                    {s.status === 'trial' && (
                      <span className="badge accent" style={{ marginTop: 4 }}>
                        <Sparkles size={12} /> пробний
                      </span>
                    )}
                    {label && label.tone !== 'good' && <span className={`badge ${label.tone === 'neutral' ? '' : label.tone} sc-pay`}>{label.text}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="section-title">
          <h2>Групи</h2>
          <button className="link-btn" onClick={() => open({ kind: 'group' })}>
            + Нова група
          </button>
        </div>
        {groups.length === 0 ? (
          <div className="card faint" style={{ fontSize: 14 }}>
            Групових занять поки немає. Коли з'являться — створіть групу з учнями та розкладом, і заняття будуть у календарі.
          </div>
        ) : (
          <div className="list">
            {groups.map((g) => (
              <button key={g.id} className="list-item" onClick={() => open({ kind: 'group', id: g.id })}>
                <Avatar name={g.name} color={g.color} size={40} />
                <div className="list-main">
                  <div className="list-title">{g.name}</div>
                  <div className="list-sub">
                    {g.studentIds.map((id) => students.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'без учасників'}
                  </div>
                </div>
                <div className="list-end">
                  <div style={{ fontWeight: 700 }}>{money(g.price)}</div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {g.schedule.map((sl) => `${weekdayShort(sl.weekday)} ${sl.time}`).join(', ')}
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

/* ---------- Student page ---------- */

type Tab = 'overview' | 'lessons' | 'topics' | 'payments' | 'notes';
type LessonFilter = 'all' | 'unpaid' | 'cancelled' | 'moved';

export function StudentPage({ id }: { id: string }) {
  const st = useData((s) => s.students[id]);
  const rec = useData((s) => s.lessons);
  const open = useUi((s) => s.open);
  const accounts = useAccounts();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('overview');
  const [filter, setFilter] = useState<LessonFilter>('all');

  if (!st || st.deletedAt) {
    return (
      <div className="screen">
        <div className="screen-inner">
          <div className="screen-head">
            <button className="icon-btn" onClick={() => navigate('/students')} aria-label="Назад">
              <ChevronLeft size={24} />
            </button>
          </div>
          <Empty icon={<UserRound size={36} />} title="Учня не знайдено" />
        </div>
      </div>
    );
  }

  const lessons = lessonsOfStudent(rec, id);
  const total = summarize(lessons, null, now, id);
  const curR = periodRange('month', new Date());
  const prevR = periodRange('month', shiftPeriod('month', new Date(), -1));
  const cur = summarize(lessons, curR, now, id);
  const prev = summarize(lessons, prevR, now, id);
  const tz = st.timezone && zoneDiffers(st.timezone) ? st.timezone : '';
  const c = st.contact;
  const account = accounts.get(id);
  const payLabel = account ? accountLabel(account, st) : null;

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <button className="icon-btn" onClick={() => back('/students')} aria-label="Назад">
            <ChevronLeft size={24} />
          </button>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={() => open({ kind: 'student', id })} aria-label="Редагувати">
            <Pencil size={20} />
          </button>
        </div>

        <div className="sp-hero rise">
          <Avatar name={st.name} color={st.color} size={76} />
          <div className="sp-id">
            <h1>{st.name}</h1>
            <div className="muted" style={{ fontWeight: 600 }}>
              {[st.subject, st.grade].filter(Boolean).join(' · ')}
            </div>
            <div className="sc-slots" style={{ marginTop: 8 }}>
              {st.status !== 'active' && (
                <span className={st.status === 'trial' ? 'badge accent' : 'badge warn'}>
                  {st.status === 'trial' ? 'Пробний' : st.status === 'paused' ? 'На паузі' : 'В архіві'}
                </span>
              )}
              {st.schedule.map((sl) => (
                <span key={sl.id} className="badge accent">
                  {weekdayShort(sl.weekday)} {sl.time}
                </span>
              ))}
              <span className="badge">{money(st.price)} / урок</span>
              {tz && (
                <span className="badge">
                  {zoneLabel(tz)} · зараз {timeInZone(now, tz)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="sp-actions">
          <button className="btn btn-primary" onClick={() => open({ kind: 'newLesson', studentId: id })}>
            <CalendarPlus size={18} /> Урок
          </button>
          {c.telegram && (
            <a className="btn btn-ghost" href={`https://t.me/${c.telegram}`} target="_blank" rel="noreferrer" aria-label="Telegram">
              <MessageCircle size={18} />
            </a>
          )}
          {c.phone && (
            <a className="btn btn-ghost" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} aria-label="Подзвонити">
              <Phone size={18} />
            </a>
          )}
          {c.email && (
            <a className="btn btn-ghost" href={`mailto:${c.email}`} aria-label="Email">
              <Mail size={18} />
            </a>
          )}
          {c.parent && <span className="faint sp-parent">Батьки: {c.parent}</span>}
        </div>

        {(st.status !== 'trial' || total.done > 0) && <div className="tiles four">
          <Tile label="Уроків проведено" value={total.done} sub={`з ${fmt(st.startDate, 'd MMMM yyyy')}`} />
          <Tile
            label="Дохід за весь час"
            value={<Money value={total.earned} />}
            sub={total.done ? `≈ ${money(total.avgPrice)} за урок` : '—'}
          />
          <Tile
            label={`${cap(fmt(new Date(), 'LLLL'))}`}
            value={nPlural(cur.done + cur.planned, LESSONS)}
            sub={
              prev.done > 0 ? (
                <>
                  <Delta pct={Math.round(((cur.done + cur.planned - prev.done) / prev.done) * 100)} /> до минулого
                </>
              ) : (
                `проведено ${cur.done}`
              )
            }
          />
          {account && payLabel && (
            <Tile
              label={account.debt > 0 ? 'Борг' : 'Оплачено наперед'}
              value={account.debt > 0 ? money(account.debt) : nPlural(account.lessonsLeft, LESSONS)}
              sub={<span className={`pay-state ${payLabel.tone}`}>{payLabel.text}</span>}
              onClick={() => setTab('payments')}
            />
          )}
        </div>}

        <div className="sp-tabs">
          <Segmented
            label="Розділ"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Огляд' },
              { value: 'lessons', label: 'Уроки' },
              { value: 'topics', label: 'Теми' },
              { value: 'payments', label: 'Оплати' },
              { value: 'notes', label: 'Нотатки' },
            ]}
          />
        </div>

        <div key={tab} className="fade">
          {tab === 'overview' && <Overview st={st} lessons={lessons} now={now} />}
          {tab === 'lessons' && account && (
            <LessonHistory st={st} lessons={lessons} now={now} filter={filter} setFilter={setFilter} account={account} />
          )}
          {tab === 'topics' && <Topics st={st} lessons={lessons} now={now} />}
          {tab === 'payments' && account && <Payments st={st} account={account} />}
          {tab === 'notes' && <Notes st={st} />}
        </div>
      </div>
    </div>
  );
}

function Overview({ st, lessons, now }: { st: Student; lessons: Lesson[]; now: string }) {
  const open = useUi((s) => s.open);
  const groups = useData((s) => s.groups);
  const payments = livePayments(useData((s) => s.payments));
  const series = monthSeries(lessons, payments, new Date(), 6, now, st.id);
  const trial = lessons.find((l) => isTrial(l) && l.status !== 'cancelled');
  const total = summarize(lessons, null, now, st.id);
  const upcoming = lessons.filter((l) => l.status === 'planned' && l.start >= now).slice(0, 4);
  const hasGrades = series.some((p) => p.avgGrade != null);

  return (
    <>
      {trial && <TrialCard lesson={trial} />}

      <div className="card">
        <div className="card-title">
          <h3>Найближчі уроки</h3>
        </div>
        {upcoming.length === 0 ? (
          <div className="faint" style={{ fontSize: 14 }}>
            Немає запланованих уроків
          </div>
        ) : (
          <div className="mini-list">
            {upcoming.map((l) => (
              <button key={l.id} className="mini-row" onClick={() => open({ kind: 'lesson', id: l.id })}>
                <span className="mini-date">{shortDay(l.start)}</span>
                <span className="mini-time">{timeOf(l.start)}</span>
                <span className="mini-topic">
                  {isTrial(l) ? 'Пробний урок' : l.groupId ? `${groups[l.groupId]?.name ?? 'Група'} · ` : ''}
                  {isTrial(l) ? '' : l.topic || <span className="faint">тема не вказана</span>}
                </span>
                {l.moves.length > 0 && <CornerUpRight size={15} className="faint" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Уроки по місяцях</h3>
          <span className="faint" style={{ fontSize: 13 }}>
            проведено
          </span>
        </div>
        <ColumnChart
          label="Проведені уроки по місяцях"
          data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p.done, highlight: p.current }))}
          format={(v) => String(v)}
          height={170}
        />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Засвоєння тем</h3>
          {total.avgGrade != null && (
            <span className="faint" style={{ fontSize: 13 }}>
              у середньому {grade1(total.avgGrade)} з 5
            </span>
          )}
        </div>
        {hasGrades ? (
          <GradeLine
            label="Середня оцінка засвоєння по місяцях"
            data={series.map((p) => ({ key: p.key, label: p.label, title: p.longLabel, value: p.avgGrade }))}
          />
        ) : (
          <div className="faint" style={{ fontSize: 14 }}>
            Ставте оцінку засвоєння в картці уроку — тут з'явиться графік прогресу.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Відвідуваність</h3>
          <span className="faint" style={{ fontSize: 13 }}>
            перенесень: {total.moved}
          </span>
        </div>
        <StackBar
          parts={[
            { key: 'done', label: 'Проведено', value: total.done, color: 'var(--good)' },
            { key: 'cs', label: 'Скасовано учнем', value: total.cancelledByStudent, color: 'var(--bad)' },
            { key: 'ct', label: 'Скасовано мною', value: total.cancelledByTeacher, color: 'var(--text-3)' },
          ]}
        />
      </div>
    </>
  );
}

const FILTERS: { value: LessonFilter; label: string }[] = [
  { value: 'all', label: 'Усі' },
  { value: 'unpaid', label: 'Не оплачені' },
  { value: 'cancelled', label: 'Скасовані' },
  { value: 'moved', label: 'Перенесені' },
];

function LessonHistory({
  st,
  lessons,
  now,
  filter,
  setFilter,
  account,
}: {
  st: Student;
  lessons: Lesson[];
  now: string;
  filter: LessonFilter;
  setFilter: (f: LessonFilter) => void;
  account: Account;
}) {
  const groups = useData((s) => s.groups);
  const open = useUi((s) => s.open);

  const past = lessons
    .filter((l) => l.start <= now || l.status !== 'planned')
    .filter((l) => {
      const p = l.participants.find((x) => x.studentId === st.id);
      if (filter === 'unpaid') return !!p && chargeOf(l, p) > 0 && !account.covered.has(l.id);
      if (filter === 'cancelled') return l.status === 'cancelled';
      if (filter === 'moved') return l.moves.length > 0;
      return true;
    })
    .slice()
    .reverse();

  const months = new Map<string, Lesson[]>();
  for (const l of past) {
    const k = l.start.slice(0, 7);
    const arr = months.get(k);
    if (arr) arr.push(l);
    else months.set(k, [l]);
  }

  return (
    <>
      <div className="chips" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.value} className="chip sm" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      {past.length === 0 && <Empty title="Уроків немає" />}
      {[...months.entries()].map(([k, ls]) => {
        const sum = summarize(ls, null, now, st.id);
        return (
          <div key={k} className="month-block">
            <div className="month-head">
              <span>{cap(fmt(parseISO(`${k}-01`), 'LLLL yyyy'))}</span>
              <span className="faint">
                {nPlural(sum.done, LESSONS)} · {money(sum.earned)}
              </span>
            </div>
            <div className="list">
              {ls.map((l) => {
                const p = l.participants.find((x) => x.studentId === st.id);
                const charged = p ? chargeOf(l, p) > 0 : false;
                const paid = account.covered.has(l.id);
                return (
                  <button key={l.id} className="list-item" onClick={() => open({ kind: 'lesson', id: l.id })}>
                    <span className="date-chip">
                      <b>{parseISO(l.start).getDate()}</b>
                      <span>{fmt(l.start, 'EEEEEE')}</span>
                    </span>
                    <div className="list-main">
                      <div className="list-title" style={l.status === 'cancelled' ? { color: 'var(--text-3)' } : undefined}>
                        {l.status === 'cancelled'
                          ? `Скасовано${l.cancel?.reason ? ` · ${l.cancel.reason}` : ''}`
                          : isTrial(l)
                            ? 'Пробний урок'
                            : l.topic || 'Тема не вказана'}
                      </div>
                      <div className="list-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>
                          {timeOf(l.start)}–{timeOf(endStamp(l.start, l.duration))}
                        </span>
                        {l.groupId && (
                          <span>
                            <Users size={12} /> {groups[l.groupId]?.name}
                          </span>
                        )}
                        {l.moves.length > 0 && <CornerUpRight size={13} />}
                        {l.status === 'planned' && <StatusBadge lesson={l} now={now} />}
                        <GradeMini value={p?.grade} />
                      </div>
                    </div>
                    {p && !isTrial(l) && (
                      <div className="list-end">
                        <div style={{ fontWeight: 750, color: charged ? undefined : 'var(--text-3)' }}>{money(p.price)}</div>
                        {charged && <span className={paid ? 'paid-dot ok' : 'paid-dot'}>{paid ? 'оплачено' : 'не оплачено'}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Topics({ st, lessons, now }: { st: Student; lessons: Lesson[]; now: string }) {
  const open = useUi((s) => s.open);
  const done = lessons.filter((l) => l.status === 'done' && l.topic && l.start <= now);
  const unique = new Set(done.map((l) => l.topic.trim().toLowerCase())).size;
  return (
    <>
      <div className="topics-head">
        <b>{unique}</b> {plural(unique, TOPICS)} пройдено · {nPlural(done.length, LESSONS)} з темою
      </div>
      {done.length === 0 ? (
        <Empty title="Ще немає тем">Записуйте тему в картці уроку — тут збереться вся програма учня.</Empty>
      ) : (
        <ol className="topic-list">
          {done
            .map((l, i) => ({ l, n: i + 1 }))
            .reverse()
            .map(({ l, n }) => (
              <li key={l.id}>
                <button onClick={() => open({ kind: 'lesson', id: l.id })}>
                  <span className="topic-n">{n}</span>
                  <span className="topic-main">
                    <span className="topic-title">{l.topic}</span>
                    <span className="faint">{fmt(l.start, 'd MMMM yyyy')}</span>
                  </span>
                  <GradeMini value={l.participants.find((p) => p.studentId === st.id)?.grade} />
                </button>
              </li>
            ))}
        </ol>
      )}
    </>
  );
}

function TrialCard({ lesson }: { lesson: Lesson }) {
  const open = useUi((s) => s.open);
  const r = lesson.trial;
  const outcome = TRIAL_OUTCOMES.find((o) => o.value === r?.outcome)?.label;
  const empty = !r || (!r.level && !r.strengths && !r.weaknesses && !r.plan);
  return (
    <button className="card trial-card" onClick={() => open({ kind: 'lesson', id: lesson.id })}>
      <div className="card-title">
        <h3>
          <Sparkles size={18} /> Пробний урок · {fmt(lesson.start, 'd MMMM')}
        </h3>
        {outcome && <span className="badge accent">{outcome}</span>}
      </div>
      {empty ? (
        <div className="faint" style={{ fontSize: 14 }}>
          {lesson.status === 'planned' ? 'Ще попереду. Після уроку заповніть звіт у картці уроку.' : 'Звіт не заповнено — натисніть, щоб додати.'}
        </div>
      ) : (
        <dl className="trial-dl">
          {r.level && (
            <>
              <dt>Рівень</dt>
              <dd>{r.level}</dd>
            </>
          )}
          {r.strengths && (
            <>
              <dt>Сильні сторони</dt>
              <dd>{r.strengths}</dd>
            </>
          )}
          {r.weaknesses && (
            <>
              <dt>Що підтягнути</dt>
              <dd>{r.weaknesses}</dd>
            </>
          )}
          {r.plan && (
            <>
              <dt>План</dt>
              <dd>{r.plan}</dd>
            </>
          )}
        </dl>
      )}
    </button>
  );
}

function Payments({ st, account }: { st: Student; account: Account }) {
  const all = livePayments(useData((s) => s.payments));
  const open = useUi((s) => s.open);
  const list = all.filter((p) => p.studentId === st.id);
  const label = accountLabel(account, st);
  return (
    <>
      <div className="card pay-summary">
        <div>
          <div className="tile-label">{st.billing === 'prepaid' ? 'Платять наперед, пакетами' : 'Платять після кожного уроку'}</div>
          <div className={`pay-big ${label.tone}`}>{label.text}</div>
          <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
            Усього внесено {money(account.paid)} · уроків на {money(account.charged)}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => open({ kind: 'payment', studentId: st.id })}>
          <Wallet size={18} /> Внести оплату
        </button>
      </div>
      {list.length === 0 ? (
        <Empty title="Оплат ще не було" />
      ) : (
        <div className="list" style={{ marginTop: 14 }}>
          {list.map((p) => (
            <button key={p.id} className="list-item" onClick={() => open({ kind: 'payment', id: p.id })}>
              <span className="date-chip">
                <b>{parseISO(p.date).getDate()}</b>
                <span>{fmt(p.date, 'LLL').replace('.', '')}</span>
              </span>
              <div className="list-main">
                <div className="list-title">{money(p.amount)}</div>
                <div className="list-sub">
                  {p.lessons ? nPlural(p.lessons, LESSONS) : 'довільна сума'}
                  {p.note && ` · ${p.note}`}
                </div>
              </div>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {fmt(p.date, 'yyyy')}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Notes({ st }: { st: Student }) {
  const addNote = useData((s) => s.addNote);
  const deleteNote = useData((s) => s.deleteNote);
  const [text, setText] = useState('');
  return (
    <>
      <div className="card">
        <textarea
          className="textarea"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Що вдається, над чим працювати, домовленості з батьками…"
          aria-label="Нова нотатка"
        />
        <button
          className="btn btn-primary btn-sm"
          style={{ marginTop: 10 }}
          disabled={!text.trim()}
          onClick={() => {
            addNote(st.id, text);
            setText('');
          }}
        >
          Зберегти нотатку
        </button>
      </div>
      {st.notes.length === 0 ? (
        <Empty title="Нотаток поки немає" />
      ) : (
        <div className="notes">
          {st.notes.map((n) => (
            <div key={n.id} className="note">
              <div className="note-date">{fmt(n.date, 'd MMMM yyyy')}</div>
              <div className="note-text">{n.text}</div>
              <button className="icon-btn" onClick={() => deleteNote(st.id, n.id)} aria-label="Видалити нотатку">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

