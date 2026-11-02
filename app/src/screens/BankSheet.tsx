import { Check, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { bankCheck, discrepancyHints, lastDay } from '../data/bank';
import { useLiveLessons, useLivePayments, useReceived } from '../data/selectors';
import { useData } from '../data/store';
import { periodLabel } from '../data/taxes';
import { cap, fmt, todayKey } from '../lib/dates';
import { money, signedMoney as signed } from '../lib/format';
import { Sheet, Switch } from '../ui/components';
import { NumberInput } from '../ui/fields';
import { ask, useUi, type Overlay } from '../ui/uiStore';

export function BankSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const stored = useData((s) => s.bankMonths[month]);
  const students = useData((s) => s.students);
  const saveBankMonth = useData((s) => s.saveBankMonth);
  const deleteBankMonth = useData((s) => s.deleteBankMonth);
  const payments = useLivePayments();
  const lessons = useLiveLessons();
  const recorded = useReceived().records.get(month) ?? 0;
  const open = useUi((s) => s.open);
  const notify = useUi((s) => s.notify);

  const live = stored && !stored.deletedAt ? stored : undefined;
  const before = bankCheck(live, recorded);
  const [amount, setAmount] = useState(live?.amount ?? 0);
  const [accept, setAccept] = useState(before.state === 'accepted');
  const [note, setNote] = useState(live?.note ?? '');

  const diff = amount - recorded;
  const hasDiff = amount > 0 && Math.abs(diff) >= 0.5;
  const valid = amount > 0 && (!hasDiff || !accept || note.trim().length > 0);
  const hints = hasDiff ? discrepancyHints(month, diff, payments, lessons, students) : [];
  const inMonth = payments.filter((p) => !p.opening && p.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
  const label = periodLabel(month, true);
  const today = todayKey();
  const payDay = lastDay(month) < today ? lastDay(month) : today;

  const store = () =>
    saveBankMonth({ month, amount, note: note.trim(), acceptedDiff: hasDiff && accept && note.trim() ? diff : undefined });

  const save = () => {
    if (!valid) return;
    store();
    notify(!hasDiff ? 'Звірено з банком' : accept ? 'Розбіжність прийнято з поясненням' : 'Збережено — розбіжність лишається відкритою');
    onClose();
  };

  /** Goes to a payment; what is typed here is saved first. */
  const go = (o: Overlay) => {
    if (amount > 0) store();
    open(o);
  };

  const remove = async () => {
    if (!live) return;
    const yes = await ask({ title: 'Видалити звірку?', text: `${cap(label)}: ${money(live.amount)} за випискою`, ok: 'Видалити', danger: true });
    if (!yes) return;
    deleteBankMonth(month);
    notify('Звірку видалено', () => saveBankMonth(live));
    onClose();
  };

  return (
    <Sheet
      title={`Звірка з банком · ${cap(label)}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!valid} onClick={save}>
          <Check size={18} /> Зберегти
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Надійшло на рахунок за випискою</span>
        <span className="input-wrap">
          <NumberInput value={amount} label="Сума за випискою" onChange={setAmount} />
          <span className="input-suffix">₴</span>
        </span>
        <span className="field-hint">Усі надходження на рахунок ФОП за {label} — з виписки або застосунку банку.</span>
      </label>

      {amount > 0 && (
        <div className="bank-compare" data-ok={hasDiff ? undefined : ''}>
          <dl className="fin-dl">
            <div>
              <dt>За випискою</dt>
              <dd>{money(amount)}</dd>
            </div>
            <div>
              <dt>Оплати в застосунку</dt>
              <dd>{money(recorded)}</dd>
            </div>
            <div className="fin-recon-sum">
              <dt>{!hasDiff ? 'Усе збігається' : diff > 0 ? 'У банку більше на' : 'У банку менше на'}</dt>
              <dd>{hasDiff ? money(Math.abs(diff)) : <Check size={18} />}</dd>
            </div>
          </dl>
        </div>
      )}

      {before.state === 'changed' && live?.acceptedDiff != null && (
        <p className="tax-note warn">
          Раніше ви пояснили розбіжність {signed(live.acceptedDiff)}: «{live.note}». Відтоді оплати за місяць змінилися — перевірте ще раз.
        </p>
      )}

      {hasDiff && (
        <>
          <h3 className="bank-h">Де може бути причина</h3>
          {hints.length > 0 ? (
            <div className="list">
              {hints.map((h) => (
                <button
                  key={h.paymentId ?? h.studentId ?? h.title}
                  className="list-item"
                  onClick={() => go(h.paymentId ? { kind: 'payment', id: h.paymentId } : { kind: 'payment', studentId: h.studentId, groupId: h.groupId, date: payDay })}
                >
                  <div className="list-main">
                    <div className="list-title">{h.title}</div>
                    <div className="list-sub wrap">{h.text}</div>
                  </div>
                  <ChevronRight size={18} className="faint" />
                </button>
              ))}
            </div>
          ) : (
            <p className="field-hint">Явних підказок немає. Порівняйте оплати нижче з випискою по одній.</p>
          )}

          <div className="toggle-row bank-accept">
            <span>
              <b>Записи правильні — прийняти розбіжність</b>
              <small>Місяць рахуватиметься за випискою, а різниця стане окремим рядком із поясненням. Якщо оплати потім зміняться, застосунок попередить.</small>
            </span>
            <Switch checked={accept} onChange={setAccept} label="Прийняти розбіжність" />
          </div>
          {accept && (
            <label className="field">
              <span className="field-label">Чому так (обов'язково)</span>
              <textarea
                className="textarea"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Напр.: збій банку, гроші зарахували 3 листопада"
              />
            </label>
          )}
        </>
      )}

      <h3 className="bank-h">
        Оплати за {label} у застосунку · {inMonth.length}
      </h3>
      {inMonth.length > 0 ? (
        <div className="list">
          {inMonth.map((p) => (
            <button key={p.id} className="list-item bank-pay" onClick={() => go({ kind: 'payment', id: p.id })}>
              <span className="bank-date">{fmt(p.date, 'd MMM')}</span>
              <div className="list-main">
                <div className="list-title">
                  {students[p.studentId]?.name ?? '—'}
                  {p.groupId && <span className="faint"> · група</span>}
                </div>
              </div>
              <b>{money(p.amount)}</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="field-hint">За цей місяць оплат не внесено.</p>
      )}
      <button className="btn btn-soft btn-block" style={{ marginTop: 10 }} onClick={() => go({ kind: 'payment', date: payDay })}>
        <Plus size={17} /> Внести оплату
      </button>

      {live && (
        <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
          <Trash2 size={17} /> Видалити звірку
        </button>
      )}
    </Sheet>
  );
}
