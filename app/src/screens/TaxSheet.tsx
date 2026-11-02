import { ChevronLeft, ChevronRight, Landmark, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLivePayments, useLiveTaxes, useMissingTaxes, useTaxPlan } from '../data/selectors';
import { useData } from '../data/store';
import {
  addMonth,
  everyAt,
  firstMonth,
  fits,
  isQuarter,
  nextPeriod,
  periodLabel,
  periodOf,
  prevPeriod,
  receivedByMonth,
  monthsOf,
  TAX_KINDS,
  taxLabel,
  thisMonth,
} from '../data/taxes';
import type { ID, TaxKind } from '../data/types';
import { cap, fmt, todayKey } from '../lib/dates';
import { money } from '../lib/format';
import { Sheet } from '../ui/components';
import { NumberInput } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';

interface Prefill {
  id?: ID;
  taxKind?: TaxKind;
  period?: string;
}

export function TaxSheet({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  const existing = useData((s) => (prefill.id ? s.taxes[prefill.id] : undefined));
  const saveTax = useData((s) => s.saveTax);
  const deleteTax = useData((s) => s.deleteTax);
  const notify = useUi((s) => s.notify);
  const open = useUi((s) => s.open);
  const { plan } = useTaxPlan();
  const taxes = useLiveTaxes();
  const payments = useLivePayments();
  const missing = useMissingTaxes();

  // Unless told otherwise, start with the oldest period that still waits for a payment.
  const suggested = (k: TaxKind) => missing.find((m) => m.kind === k)?.period ?? periodOf(plan, k, thisMonth());
  const kind0 = existing?.kind ?? prefill.taxKind ?? missing[0]?.kind ?? 'tax';
  const [kind, setKind] = useState<TaxKind>(kind0);
  const [period, setPeriod] = useState(existing?.period ?? prefill.period ?? suggested(kind0));
  const [amount, setAmount] = useState(existing?.amount ?? 0);
  const [date, setDate] = useState(existing?.date ?? todayKey());
  const [note, setNote] = useState(existing?.note ?? '');

  const today = todayKey();
  const current = periodOf(plan, kind, thisMonth());
  const every = everyAt(plan, kind, firstMonth(period));
  const valid = fits(plan, kind, period);
  const canNext = firstMonth(nextPeriod(plan, kind, period)) <= firstMonth(current);
  const canPrev = firstMonth(period) > addMonth(thisMonth(), -60);

  const pickKind = (k: TaxKind) => {
    setKind(k);
    setPeriod(existing?.kind === k ? existing.period : suggested(k));
  };

  const received = receivedByMonth(payments);
  const income = monthsOf(period).reduce((sum, m) => sum + (received.get(m) ?? 0), 0);
  const others = taxes.filter((t) => t.kind === kind && t.period === period && t.id !== existing?.id);
  const othersSum = others.reduce((s, t) => s + t.amount, 0);
  const future = date > today;
  const early = date < `${firstMonth(period)}-01`;
  const ok = valid && amount > 0 && !future && firstMonth(period) <= firstMonth(current);

  const save = () => {
    if (!ok) return;
    saveTax({ ...(existing ?? {}), kind, period, amount, date, note: note.trim() });
    notify(existing ? 'Сплату змінено' : `${taxLabel(kind)} за ${periodLabel(period)}: ${money(amount)}`);
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const yes = await ask({
      title: 'Видалити сплату?',
      text: `${taxLabel(existing.kind)} за ${periodLabel(existing.period)}, ${money(existing.amount)}`,
      ok: 'Видалити',
      danger: true,
    });
    if (!yes) return;
    deleteTax(existing.id);
    notify('Сплату видалено', () => saveTax({ ...existing, deletedAt: undefined }));
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Сплата податку' : 'Внести податок'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!ok} onClick={save}>
          <Landmark size={18} /> {existing ? 'Зберегти' : 'Внести'}
        </button>
      }
    >
      <div className="field">
        <span className="field-label">Що сплачено</span>
        <div className="billing-picker" role="radiogroup" aria-label="Що сплачено">
          {TAX_KINDS.map((k) => (
            <button key={k.value} role="radio" aria-checked={kind === k.value} onClick={() => pickKind(k.value)}>
              <b>{k.label}</b>
              <span>{k.long}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">За {every === 'quarter' ? 'який квартал' : 'який місяць'}</span>
        <div className="tax-period">
          <button className="icon-btn" disabled={!canPrev} onClick={() => setPeriod(prevPeriod(plan, kind, period))} aria-label="Попередній період">
            <ChevronLeft size={20} />
          </button>
          <b>{cap(periodLabel(period, true))}</b>
          <button className="icon-btn" disabled={!canNext} onClick={() => setPeriod(nextPeriod(plan, kind, period))} aria-label="Наступний період">
            <ChevronRight size={20} />
          </button>
        </div>
        {valid ? (
          <span className="field-hint">
            {taxLabel(kind)} ви сплачуєте {every === 'quarter' ? 'щокварталу, тому тут лише квартали' : 'щомісяця, тому тут лише місяці'}.{' '}
            <button className="link-btn" onClick={() => open({ kind: 'taxPlan' })}>
              Змінити
            </button>
          </span>
        ) : (
          <span className="field-hint bad">
            Цей запис зроблено за {isQuarter(period) ? 'квартал' : 'місяць'}, а за налаштуваннями тут {every === 'quarter' ? 'квартали' : 'місяці'}.{' '}
            <button className="link-btn" onClick={() => setPeriod(periodOf(plan, kind, firstMonth(period)))}>
              Вибрати {every === 'quarter' ? 'квартал' : 'місяць'}
            </button>
          </span>
        )}
      </div>

      {kind === 'tax' && <p className="tax-note">Надійшло на рахунок за {periodLabel(period)}: <b>{money(income)}</b></p>}
      {others.length > 0 && (
        <p className="tax-note warn">
          За {periodLabel(period)} вже внесено {money(othersSum)} ({others.map((t) => fmt(t.date, 'd MMM')).join(', ')}). Ця сплата додасться до
          неї — так вносять доплату.
        </p>
      )}

      <div className="row">
        <label className="field">
          <span className="field-label">Сума</span>
          <span className="input-wrap">
            <NumberInput value={amount} label="Сума" onChange={setAmount} />
            <span className="input-suffix">₴</span>
          </span>
        </label>
        <label className="field">
          <span className="field-label">Дата сплати</span>
          <input className="input" type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      {future && <p className="field-hint bad">Дата сплати ще не настала — внесіть податок, коли його буде сплачено.</p>}
      {!future && early && (
        <p className="field-hint warn">Дата сплати раніша за початок періоду. Якщо це не передоплата — перевірте, чи правильно вибрано період.</p>
      )}

      <label className="field">
        <span className="field-label">Примітка (необов'язково)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: разом з доплатою" />
      </label>

      {existing && (
        <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
          <Trash2 size={17} /> Видалити сплату
        </button>
      )}
    </Sheet>
  );
}
