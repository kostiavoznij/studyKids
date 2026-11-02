import { Check, ChevronLeft, ChevronRight, CircleAlert, Clock, CloudOff, Landmark, MessageSquareText, Plus, ScrollText, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bankCheck, type BankCheck } from '../data/bank';
import { balancesAt } from '../data/billing';
import { useLiveLessons, useLivePayments, useLiveTaxes, useMissingTaxes, useReceived, useTaxPlan } from '../data/selectors';
import { summarize } from '../data/stats';
import { useData } from '../data/store';
import { useSync } from '../data/sync';
import {
  addMonth,
  daysOf,
  dueText,
  everyAt,
  fits,
  isQuarter,
  lastMonth,
  moneyMonths,
  monthsOf,
  periodLabel,
  periodsIn,
  quarterOf,
  quarterStart,
  sinceLabel,
  TAX_KINDS,
  taxesByMonth,
  taxLabel,
  thisMonth,
} from '../data/taxes';
import type { TaxKind, TaxPayment, TaxPlan } from '../data/types';
import { cap, fmt } from '../lib/dates';
import { money, signedMoney as signed } from '../lib/format';
import { Empty, Segmented, useNow } from '../ui/components';
import { useUi } from '../ui/uiStore';

type View = 'month' | 'quarter' | 'year';

const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Місяць' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Рік' },
];

const STEP: Record<View, number> = { month: 1, quarter: 3, year: 12 };

const GUIDE = 'https://github.com/kostiavoznij/studyKids/blob/main/docs/SYNC_SETUP.md#оновлення-коду-коли-змінюється-codegs';

function rangeOf(view: View, anchor: string): [string, string] {
  if (view === 'month') return [anchor, anchor];
  if (view === 'quarter') return [quarterStart(anchor), addMonth(quarterStart(anchor), 2)];
  return [`${anchor.slice(0, 4)}-01`, `${anchor.slice(0, 4)}-12`];
}

function viewLabel(view: View, anchor: string) {
  if (view === 'month') return cap(periodLabel(anchor, true));
  if (view === 'quarter') return periodLabel(quarterOf(anchor), true);
  return anchor.slice(0, 4);
}

interface Status {
  kind: TaxKind;
  period: string;
  paid: TaxPayment[];
  state: 'paid' | 'missing' | 'running';
}

export function FinanceScreen() {
  const lessons = useLiveLessons();
  const payments = useLivePayments();
  const taxes = useLiveTaxes();
  const { plan, saved } = useTaxPlan();
  const missing = useMissingTaxes();
  const outdated = useSync((s) => s.configured && s.outdated);
  const saveTaxPlan = useData((s) => s.saveTaxPlan);
  const bankMonths = useData((s) => s.bankMonths);
  const open = useUi((s) => s.open);
  const now = useNow();
  const today = thisMonth();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);

  // Payments plus differences with the bank she accepted; `records` is payments alone.
  const { records, money: received } = useReceived();
  const byMonth = useMemo(() => taxesByMonth(taxes, received), [taxes, received]);

  const [from, to] = rangeOf(view, anchor);
  const months = moneyMonths(from, to, received, byMonth);
  const total = sumMonths(months);
  const recordedTotal = months.reduce((sum, m) => sum + (records.get(m.month) ?? 0), 0);
  const correction = total.received - recordedTotal;
  const checkOf = (month: string) => bankCheck(bankMonths[month], records.get(month) ?? 0);
  // Months before any money came in are left out; empty months later on stay.
  const shown = months.filter((m) => m.month <= today);
  const firstActive = shown.findIndex((m) => m.received || m.tax || m.esv);
  const rows = firstActive < 0 ? [] : shown.slice(firstActive);
  const checks = rows.map((m) => checkOf(m.month));
  const checked = checks.filter((c) => c.state === 'ok' || c.state === 'accepted').length;
  const unsettled = checks.filter((c) => c.state === 'diff' || c.state === 'changed').length;
  const earned = summarize(lessons, daysOf(from, to), now).earned;
  const before = balancesAt(lessons, payments, `${addMonth(from, -1)}-31`);
  const after = balancesAt(lessons, payments, `${to}-31`);
  const prepaidDelta = after.prepaid - before.prepaid;
  const owedDelta = after.owed - before.owed;

  // What was due for each tax in this range and whether it was entered.
  const statuses: Status[] = [];
  if (from <= today) {
    for (const { value: kind } of TAX_KINDS) {
      for (const p of periodsIn(plan, kind, from, to < today ? to : today)) {
        const span = monthsOf(p);
        const paid = taxes.filter((t) => t.kind === kind && monthsOf(t.period).some((m) => span.includes(m)));
        if (paid.length) statuses.push({ kind, period: p, paid, state: 'paid' });
        else if (lastMonth(p) >= today) statuses.push({ kind, period: p, paid, state: 'running' });
        else if (lastMonth(p) < plan.start) continue;
        else if (kind === 'tax' && !span.some((m) => (received.get(m) ?? 0) > 0)) continue;
        else statuses.push({ kind, period: p, paid, state: 'missing' });
      }
    }
  }

  const hintFor = (kind: TaxKind): { text: string; tone: string } | null => {
    const mine = statuses.filter((s) => s.kind === kind);
    const miss = mine.filter((s) => s.state === 'missing');
    if (miss.length) {
      const names = miss.slice(0, 3).map((s) => periodLabel(s.period));
      return { text: `не внесено за ${names.join(', ')}${miss.length > 3 ? ` і ще ${miss.length - 3}` : ''}`, tone: 'bad' };
    }
    const running = mine.find((s) => s.state === 'running');
    if (running) return { text: `${periodLabel(running.period)} ще триває`, tone: '' };
    if (view === 'month' && mine.some((s) => isQuarter(s.period)))
      return { text: kind === 'esv' ? `третина сплати за ${periodLabel(quarterOf(from))}` : `частка сплати за ${periodLabel(quarterOf(from))}`, tone: '' };
    return null;
  };

  const inRange = taxes.filter((t) => monthsOf(t.period).some((m) => m >= from && m <= to));
  const year = anchor.slice(0, 4);
  const yearTotal = sumMonths(moneyMonths(`${year}-01`, `${year}-12`, received, byMonth));
  const allTaxes = taxes.reduce((s, t) => s + t.amount, 0);
  const firstTax = taxes.reduce<string | null>((min, t) => (!min || t.period < min ? t.period : min), null);
  const maxRow = Math.max(1, ...rows.map((m) => Math.max(m.received, m.tax + m.esv)));
  const canNext = addMonth(from, STEP[view]) <= today;

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1>Фінанси</h1>
          <button className="icon-btn" onClick={() => open({ kind: 'taxPlan' })} aria-label="Як я сплачую податки" title="Як я сплачую податки">
            <Settings2 size={20} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => open({ kind: 'tax' })}>
            <Plus size={17} /> Податок
          </button>
        </div>

        {outdated && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            <CloudOff size={20} />
            <span style={{ flex: 1 }}>
              Податки поки зберігаються лише на цьому пристрої: скрипт у Google Таблиці старої версії. Після оновлення все відправиться саме.{' '}
              <a href={GUIDE} target="_blank" rel="noreferrer">
                Як оновити
              </a>
            </span>
          </div>
        )}

        {!saved ? (
          <div className="card fin-plan" style={{ marginBottom: 12 }}>
            <div>
              <b>Перевірте, як ви сплачуєте податки</b>
              <div className="muted">{planSummary(plan, today)}</div>
            </div>
            <div className="set-buttons">
              <button className="btn btn-primary btn-sm" onClick={() => saveTaxPlan(plan)}>
                <Check size={16} /> Усе так
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'taxPlan' })}>
                Змінити
              </button>
            </div>
          </div>
        ) : null}

        {missing.length > 0 && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            <CircleAlert size={20} />
            <span style={{ flex: 1 }}>
              Не внесено: <b>{dueText(missing.slice(0, 4))}</b>
              {missing.length > 4 && ` і ще ${missing.length - 4}`}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => open({ kind: 'tax', taxKind: missing[0].kind, period: missing[0].period })}>
              Внести
            </button>
          </div>
        )}

        <div className="stats-toolbar">
          <Segmented
            label="Період"
            value={view}
            options={VIEWS}
            onChange={(v) => {
              setView(v);
              setAnchor(today);
            }}
          />
          <div className="period-nav">
            <button className="icon-btn" onClick={() => setAnchor(addMonth(anchor, -STEP[view]))} aria-label="Попередній період">
              <ChevronLeft size={20} />
            </button>
            <span>{viewLabel(view, anchor)}</span>
            <button className="icon-btn" disabled={!canNext} onClick={() => setAnchor(addMonth(anchor, STEP[view]))} aria-label="Наступний період">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="hero-card rise">
          <div className="hero-label">Надійшло на рахунок</div>
          <div className="hero-value">{money(total.received)}</div>
          {Math.abs(correction) >= 1 && (
            <div className="hero-sub">
              оплати {money(recordedTotal)} · коригування за випискою {signed(correction)}
            </div>
          )}
          {view !== 'month' && checks.length > 0 && (
            <div className="hero-sub">
              звірено з банком {checked} з {checks.length} міс.
              {unsettled > 0 && <span className="bad"> · розбіжностей: {unsettled}</span>}
            </div>
          )}
          <SplitBar received={total.received} tax={total.tax} esv={total.esv} />
          <div className="fin-lines">
            <FinLine kind="tax" label="Податок (ЄП + ВЗ)" value={-total.tax} hint={hintFor('tax')} />
            <FinLine kind="esv" label="ЄСВ (на стаж)" value={-total.esv} hint={hintFor('esv')} />
            <FinLine kind="net" label="Чистими" value={total.net} />
          </div>
        </div>

        {view === 'month' && from <= today && <BankCard month={from} check={checkOf(from)} recorded={recordedTotal} />}

        {Math.abs(total.received - earned) >= 1 && (
          <div className="card fin-recon">
            <h3>Чому надійшло не стільки, скільки зароблено за уроки</h3>
            <dl className="fin-dl">
              <div>
                <dt>Зароблено за уроки {view === 'month' ? 'цього місяця' : view === 'quarter' ? 'цього кварталу' : 'цього року'}</dt>
                <dd>{money(earned)}</dd>
              </div>
              {Math.abs(prepaidDelta) >= 1 && (
                <div>
                  <dt>{prepaidDelta > 0 ? 'Оплатили наперед за наступні уроки' : 'Уроки, оплачені ще раніше'}</dt>
                  <dd>{signed(prepaidDelta)}</dd>
                </div>
              )}
              {Math.abs(owedDelta) >= 1 && (
                <div>
                  <dt>{owedDelta > 0 ? 'Уроки, які ще не оплатили' : 'Оплатили борги за минулі уроки'}</dt>
                  <dd>{signed(-owedDelta)}</dd>
                </div>
              )}
              {Math.abs(correction) >= 1 && (
                <div>
                  <dt>Коригування за випискою банку</dt>
                  <dd>{signed(correction)}</dd>
                </div>
              )}
              <div className="fin-recon-sum">
                <dt>Надійшло на рахунок</dt>
                <dd>{money(total.received)}</dd>
              </div>
            </dl>
            <p className="field-hint">Податок рахують із грошей, що надійшли на рахунок, тому тут головне — надходження, а не уроки.</p>
          </div>
        )}

        {view !== 'year' && statuses.length > 0 && (
          <>
            <div className="section-title">
              <h2>Податки за {view === 'month' ? 'місяць' : 'квартал'}</h2>
            </div>
            <div className="list">
              {statuses.map((s) => (
                <StatusRow key={`${s.kind}:${s.period}`} s={s} onAdd={() => open({ kind: 'tax', taxKind: s.kind, period: s.period })} onOpen={(id) => open({ kind: 'tax', id })} />
              ))}
            </div>
          </>
        )}

        {view !== 'month' && rows.length > 0 && (
          <>
            <div className="section-title">
              <h2>По місяцях</h2>
            </div>
            <div className="list">
              {rows.map((m) => (
                <button
                  key={m.month}
                  className="list-item fin-month"
                  onClick={() => {
                    setView('month');
                    setAnchor(m.month);
                  }}
                >
                  <div className="list-main">
                    <div className="rank-top">
                      <span className="list-title">{cap(periodLabel(m.month, false))}</span>
                      <span className="rank-money">{money(m.received)}</span>
                    </div>
                    <SplitBar received={m.received} tax={m.tax} esv={m.esv} scale={Math.max(m.received, m.tax + m.esv) / maxRow} />
                    <div className="list-sub">
                      податки {money(m.tax + m.esv)} · чистими {money(m.net)}
                      {missing.some((d) => monthsOf(d.period).includes(m.month)) && <span className="bad"> · не внесено податок</span>}
                      <BankMark check={checkOf(m.month)} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="section-title">
          <h2>Сплати податків</h2>
        </div>
        {inRange.length === 0 ? (
          <Empty icon={<Landmark size={28} />} title="За цей період сплат не внесено">
            <button className="btn btn-soft btn-sm" onClick={() => open({ kind: 'tax' })}>
              <Plus size={16} /> Внести податок
            </button>
          </Empty>
        ) : (
          <div className="list">
            {inRange.map((t) => (
              <button key={t.id} className="list-item" onClick={() => open({ kind: 'tax', id: t.id })}>
                <span className="insight-icon fin-kind" data-kind={t.kind}>
                  <Landmark size={17} />
                </span>
                <div className="list-main">
                  <div className="list-title">
                    {taxLabel(t.kind)} за {periodLabel(t.period)}
                  </div>
                  <div className="list-sub">
                    сплачено {fmt(t.date, 'd MMMM')}
                    {t.note && ` · ${t.note}`}
                    {!fits(plan, t.kind, t.period) && <span className="bad"> · не за графіком</span>}
                  </div>
                </div>
                <div className="list-end">
                  <b>{money(t.amount)}</b>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="card fin-totals">
          <h3>Сплачено податків</h3>
          <dl className="fin-dl">
            <div>
              <dt>
                За {year} рік
                <small>
                  податок {money(yearTotal.tax)} · ЄСВ {money(yearTotal.esv)}
                </small>
              </dt>
              <dd>{money(yearTotal.tax + yearTotal.esv)}</dd>
            </div>
            <div>
              <dt>
                Частка від надходжень
                <small>надійшло за рік {money(yearTotal.received)}</small>
              </dt>
              <dd>{yearTotal.received > 0 ? `${pct((yearTotal.tax + yearTotal.esv) / yearTotal.received)}%` : '—'}</dd>
            </div>
            <div>
              <dt>
                За весь час
                <small>{firstTax ? sinceLabel(firstTax) : 'ще нічого не внесено'}</small>
              </dt>
              <dd>{money(allTaxes)}</dd>
            </div>
          </dl>
        </div>

        {saved && (
          <button className="card fin-plan fin-plan-link" onClick={() => open({ kind: 'taxPlan' })}>
            <div>
              <b>Як я сплачую податки</b>
              <div className="muted">{planSummary(plan, today)}</div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>
        )}
      </div>
    </div>
  );
}

function sumMonths(list: { received: number; tax: number; esv: number; net: number }[]) {
  return list.reduce((a, m) => ({ received: a.received + m.received, tax: a.tax + m.tax, esv: a.esv + m.esv, net: a.net + m.net }), {
    received: 0,
    tax: 0,
    esv: 0,
    net: 0,
  });
}

const pct = (x: number) => (Math.round(x * 1000) / 10).toLocaleString('uk-UA');

function planSummary(plan: TaxPlan, today: string) {
  const word = (k: TaxKind) => (everyAt(plan, k, today) === 'quarter' ? 'щокварталу' : 'щомісяця');
  return `Податок — ${word('tax')}, ЄСВ — ${word('esv')}. Нагадування з: ${periodLabel(plan.start, true)}.`;
}

/** Received money split into what stays and what went to taxes; the numbers sit next to it, so it is decoration for screen readers. */
function SplitBar({ received, tax, esv, scale = 1 }: { received: number; tax: number; esv: number; scale?: number }) {
  const net = Math.max(0, received - tax - esv);
  return (
    <div className="fin-bar-track" aria-hidden="true">
      {net + tax + esv > 0 && (
        <div className="fin-bar" style={{ width: `${Math.max(scale, 0.02) * 100}%` }}>
          {net > 0 && <span data-kind="net" style={{ flexGrow: net }} />}
          {tax > 0 && <span data-kind="tax" style={{ flexGrow: tax }} />}
          {esv > 0 && <span data-kind="esv" style={{ flexGrow: esv }} />}
        </div>
      )}
    </div>
  );
}

function FinLine({ kind, label, value, hint }: { kind: 'net' | 'tax' | 'esv'; label: string; value: number; hint?: { text: string; tone: string } | null }) {
  return (
    <div className="fin-line" data-kind={kind}>
      <i aria-hidden="true" />
      <span className="fin-line-label">
        {label}
        {hint && <small className={hint.tone}>{hint.text}</small>}
      </span>
      <b>{kind === 'net' ? money(value) : value ? `−${money(-value)}` : money(0)}</b>
    </div>
  );
}

/** The month checked against the bank statement, or an invitation to check it. */
function BankCard({ month, check, recorded }: { month: string; check: BankCheck; recorded: number }) {
  const open = useUi((s) => s.open);
  const st = check.statement;
  const view = {
    none: { state: '', icon: <ScrollText size={18} />, title: 'Звірте з випискою банку', sub: 'Впишіть суму надходжень з виписки — застосунок порівняє її з оплатами', action: 'Звірити' },
    ok: { state: 'paid', icon: <Check size={18} />, title: 'Звірено з банком', sub: `у виписці ${money(st?.amount ?? 0)} — як і в застосунку`, action: 'Змінити' },
    diff: {
      state: 'missing',
      icon: <CircleAlert size={18} />,
      title: `Розбіжність з банком: ${signed(check.diff)}`,
      sub: `у виписці ${money(st?.amount ?? 0)}, оплат внесено на ${money(recorded)}`,
      action: 'Розібратися',
    },
    accepted: { state: 'accepted', icon: <MessageSquareText size={18} />, title: `Розбіжність ${signed(check.diff)} пояснено`, sub: `«${st?.note}»`, action: 'Змінити' },
    changed: {
      state: 'missing',
      icon: <CircleAlert size={18} />,
      title: 'Розбіжність з банком змінилася',
      sub: `пояснювали ${signed(st?.acceptedDiff ?? 0)}, а тепер ${signed(check.diff)} — перевірте`,
      action: 'Розібратися',
    },
  }[check.state];
  return (
    <div className="list bank-card">
      <div className="list-item fin-status" data-state={view.state}>
        <span className="insight-icon">{view.icon}</span>
        <div className="list-main">
          <div className="list-title">{view.title}</div>
          <div className="list-sub wrap">{view.sub}</div>
        </div>
        <button className="btn btn-sm btn-soft" onClick={() => open({ kind: 'bank', month })}>
          {view.action}
        </button>
      </div>
    </div>
  );
}

function BankMark({ check }: { check?: BankCheck }) {
  if (!check || check.state === 'none') return null;
  if (check.state === 'ok') return <span className="good"> · звірено</span>;
  if (check.state === 'accepted') return <span> · звірено з поясненням</span>;
  return <span className="bad"> · розбіжність з банком</span>;
}

function StatusRow({ s, onAdd, onOpen }: { s: Status; onAdd: () => void; onOpen: (id: string) => void }) {
  const title = `${taxLabel(s.kind)} за ${periodLabel(s.period)}`;
  if (s.state === 'paid') {
    const sum = s.paid.reduce((a, t) => a + t.amount, 0);
    return (
      <button className="list-item fin-status" data-state="paid" onClick={() => onOpen(s.paid[0].id)}>
        <span className="insight-icon">
          <Check size={18} />
        </span>
        <div className="list-main">
          <div className="list-title">{title}</div>
          <div className="list-sub">сплачено {s.paid.map((t) => fmt(t.date, 'd MMM')).join(', ')}</div>
        </div>
        <div className="list-end">
          <b>{money(sum)}</b>
        </div>
      </button>
    );
  }
  return (
    <div className="list-item fin-status" data-state={s.state}>
      <span className="insight-icon">{s.state === 'missing' ? <CircleAlert size={18} /> : <Clock size={18} />}</span>
      <div className="list-main">
        <div className="list-title">{title}</div>
        <div className="list-sub">{s.state === 'missing' ? 'ще не внесено' : `${isQuarter(s.period) ? 'квартал' : 'місяць'} ще триває`}</div>
      </div>
      <button className="btn btn-sm btn-soft" onClick={onAdd}>
        Внести
      </button>
    </div>
  );
}
