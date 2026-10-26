import { Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { accountLabel, useAccounts } from '../data/billing';
import { PACKAGES } from '../data/constants';
import { useLiveStudents } from '../data/selectors';
import { useData } from '../data/store';
import type { ID } from '../data/types';
import { todayKey } from '../lib/dates';
import { LESSONS, money, nPlural, plural } from '../lib/format';
import { Sheet } from '../ui/components';
import { NumberInput, StudentChips } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';

interface Prefill {
  id?: ID;
  studentId?: ID;
  lessons?: number;
}

export function PaymentSheet({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  const existing = useData((s) => (prefill.id ? s.payments[prefill.id] : undefined));
  const studentsRec = useData((s) => s.students);
  const savePayment = useData((s) => s.savePayment);
  const deletePayment = useData((s) => s.deletePayment);
  const notify = useUi((s) => s.notify);
  const accounts = useAccounts();
  const students = useLiveStudents().filter((s) => s.status === 'active' || s.status === 'trial' || s.id === existing?.studentId);

  const initialStudent = existing?.studentId ?? prefill.studentId ?? '';
  const st0 = studentsRec[initialStudent];
  const initialCount = existing ? existing.lessons ?? null : prefill.lessons ?? (st0?.billing === 'after' ? 1 : 4);
  const [studentId, setStudentId] = useState<ID>(initialStudent);
  const [count, setCount] = useState<number | null>(initialCount);
  const [amount, setAmount] = useState<number>(existing?.amount ?? (st0 && initialCount ? st0.price * initialCount : 0));
  const [date, setDate] = useState(existing?.date ?? todayKey());
  const [note, setNote] = useState(existing?.note ?? '');

  const st = studentsRec[studentId];
  const account = st ? accounts.get(st.id) : undefined;

  const pickStudent = (id: ID) => {
    const next = studentsRec[id];
    setStudentId(id);
    if (next && !existing) {
      const n = next.billing === 'after' ? 1 : count ?? 4;
      setCount(n);
      setAmount(n * next.price);
    }
  };
  const pickCount = (n: number) => {
    setCount(n);
    if (st) setAmount(n * st.price);
  };

  // What the balance looks like once this payment is in.
  const before = account ? account.balance - (existing ? existing.amount : 0) : 0;
  const after = before + (amount || 0);
  const afterLessons = st && st.price > 0 ? Math.floor((Math.max(0, after) + 0.5) / st.price) : 0;

  const save = () => {
    if (!st || !(amount > 0)) return;
    savePayment({
      ...(existing ?? {}),
      studentId: st.id,
      amount,
      lessons: count ?? undefined,
      date,
      note: note.trim(),
    });
    notify(existing ? 'Оплату змінено' : `Оплату внесено: ${money(amount)}`);
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ask({ title: 'Видалити оплату?', text: `${money(existing.amount)} від ${fmtDate(existing.date)}`, ok: 'Видалити', danger: true });
    if (!ok) return;
    deletePayment(existing.id);
    notify('Оплату видалено', () => savePayment({ ...existing, deletedAt: undefined }));
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Оплата' : 'Внести оплату'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!st || !(amount > 0)} onClick={save}>
          <Wallet size={18} /> {existing ? 'Зберегти' : 'Внести оплату'}
        </button>
      }
    >
      {!prefill.studentId && !existing ? (
        <div className="field">
          <span className="field-label">Від кого</span>
          <StudentChips students={students} selected={studentId ? [studentId] : []} onToggle={pickStudent} />
        </div>
      ) : (
        st && account && (
          <div className="pay-account">
            <span className="field-label">{st.name}</span>
            <span className={`badge ${toneClass(accountLabel(account, st).tone)}`}>{accountLabel(account, st).text}</span>
          </div>
        )
      )}

      {st && (
        <>
          <div className="field">
            <span className="field-label">За скільки уроків</span>
            <div className="count-chips" role="radiogroup" aria-label="Кількість уроків">
              {PACKAGES.map((n) => (
                <button key={n} role="radio" className="chip" aria-checked={count === n} aria-pressed={count === n} onClick={() => pickCount(n)}>
                  {n}
                </button>
              ))}
            </div>
            <span className="field-hint">
              {count ? `${nPlural(count, LESSONS)} × ${money(st.price)} = ${money(count * st.price)}` : `Довільна сума · ${money(st.price)} за урок`}
            </span>
          </div>

          <div className="row">
            <label className="field">
              <span className="field-label">Сума</span>
              <span className="input-wrap">
                <NumberInput
                  value={amount}
                  label="Сума"
                  onChange={(v) => {
                    setAmount(v);
                    setCount(st.price > 0 && v % st.price === 0 && v > 0 ? v / st.price : null);
                  }}
                />
                <span className="input-suffix">₴</span>
              </span>
            </label>
            <label className="field">
              <span className="field-label">Дата</span>
              <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Примітка (необов'язково)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: переказ на картку" />
          </label>

          {amount > 0 && (
            <div className="pay-preview">
              Після оплати:{' '}
              <b>
                {after < -0.5
                  ? `ще борг ${money(-after)}`
                  : afterLessons > 0
                    ? `оплачено ${afterLessons} ${plural(afterLessons, LESSONS)} наперед`
                    : 'усе оплачено'}
              </b>
            </div>
          )}

          {existing && (
            <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
              <Trash2 size={17} /> Видалити оплату
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

export const toneClass = (tone: string) => (tone === 'neutral' ? '' : tone);

const fmtDate = (d: string) => d.split('-').reverse().join('.');
