import { Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { lastDay } from '../data/bank';
import { accountLabel, potOf, urgentPot, useAccounts } from '../data/billing';
import { PACKAGES } from '../data/constants';
import { useLivePayments, useLiveStudents } from '../data/selectors';
import { useData } from '../data/store';
import { addMonth, thisMonth } from '../data/taxes';
import type { ID } from '../data/types';
import { todayKey } from '../lib/dates';
import { LESSONS, money, nPlural, plural } from '../lib/format';
import { Segmented, Sheet, Switch } from '../ui/components';
import { NumberInput, StudentChips } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';

interface Prefill {
  id?: ID;
  studentId?: ID;
  groupId?: ID;
  lessons?: number;
  date?: string;
}

export function PaymentSheet({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  const existing = useData((s) => (prefill.id ? s.payments[prefill.id] : undefined));
  const studentsRec = useData((s) => s.students);
  const groupsRec = useData((s) => s.groups);
  const savePayment = useData((s) => s.savePayment);
  const deletePayment = useData((s) => s.deletePayment);
  const notify = useUi((s) => s.notify);
  const accounts = useAccounts();
  const payments = useLivePayments();
  const students = useLiveStudents().filter((s) => s.status === 'active' || s.status === 'trial' || s.id === existing?.studentId);

  // What the money is for: '' — individual lessons, otherwise a group's id.
  // By default — whatever needs paying first, individual lessons while all is fine.
  const defaultFor = (id: ID) => {
    const a = accounts.get(id);
    return (a && urgentPot(a)?.groupId) ?? '';
  };
  const priceOf = (id: ID, forId: string) => (forId ? groupsRec[forId]?.price : studentsRec[id]?.price) ?? 0;

  const initialStudent = existing?.studentId ?? prefill.studentId ?? '';
  const initialFor = existing ? existing.groupId ?? '' : prefill.groupId ?? defaultFor(initialStudent);
  const st0 = studentsRec[initialStudent];
  const initialCount = existing ? existing.lessons ?? null : prefill.lessons ?? (st0?.billing === 'after' ? 1 : 4);
  const [studentId, setStudentId] = useState<ID>(initialStudent);
  const [forId, setForId] = useState<string>(initialFor);
  const [count, setCount] = useState<number | null>(initialCount);
  const [amount, setAmount] = useState<number>(existing?.amount ?? (st0 && initialCount ? priceOf(initialStudent, initialFor) * initialCount : 0));
  const [date, setDate] = useState(existing?.date ?? prefill.date ?? todayKey());
  const [note, setNote] = useState(existing?.note ?? '');
  const [opening, setOpening] = useState(!!existing?.opening);

  const st = studentsRec[studentId];
  const account = st ? accounts.get(st.id) : undefined;
  const price = priceOf(studentId, forId);

  // Groups the student is in, plus any group the family still has money or lessons in.
  const groupIds = new Set<ID>();
  for (const g of Object.values(groupsRec)) if (!g.deletedAt && g.studentIds.includes(studentId)) groupIds.add(g.id);
  for (const x of account?.pots ?? []) if (x.groupId) groupIds.add(x.groupId);
  if (forId) groupIds.add(forId);
  const forOptions = [
    { value: '', label: 'Індивідуальні' },
    ...[...groupIds].map((id) => ({ value: id, label: `Група «${groupsRec[id]?.name ?? '—'}»` })),
  ];

  // A balance left from before the records began only matters while moving in:
  // offered for a family with no payments yet, or a date in an earlier month.
  const monthStart = `${thisMonth()}-01`;
  const firstPayment = !payments.some((p) => p.studentId === studentId && p.id !== existing?.id);
  const offerOpening = !!st && (opening || firstPayment || date < monthStart);
  const toggleOpening = (on: boolean) => {
    setOpening(on);
    if (on && date >= monthStart) setDate(lastDay(addMonth(thisMonth(), -1)));
  };

  const pickStudent = (id: ID) => {
    const next = studentsRec[id];
    setStudentId(id);
    if (next && !existing) {
      const f = defaultFor(id);
      const n = next.billing === 'after' ? 1 : count ?? 4;
      setForId(f);
      setCount(n);
      setAmount(n * priceOf(id, f));
    }
  };
  const pickFor = (f: string) => {
    setForId(f);
    if (count) setAmount(count * priceOf(studentId, f));
  };
  const pickCount = (n: number) => {
    setCount(n);
    if (st) setAmount(n * price);
  };

  // What the balance of this kind of lessons looks like once this payment is in.
  const pot = account ? potOf(account, forId || undefined) : undefined;
  const before = (pot?.balance ?? 0) - (existing && (existing.groupId ?? '') === forId ? existing.amount : 0);
  const after = before + (amount || 0);
  const afterLessons = price > 0 ? Math.floor((Math.max(0, after) + 0.5) / price) : 0;

  const save = () => {
    if (!st || !(amount > 0)) return;
    savePayment({
      ...(existing ?? {}),
      studentId: st.id,
      groupId: forId || undefined,
      amount,
      lessons: count ?? undefined,
      date,
      note: note.trim(),
      opening: opening || undefined,
    });
    notify(existing ? 'Оплату змінено' : opening ? `Залишок внесено: ${money(amount)}` : `Оплату внесено: ${money(amount)}`);
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
          {forOptions.length > 1 && (
            <div className="field">
              <span className="field-label">За які уроки</span>
              <Segmented label="За які уроки" value={forId} options={forOptions} onChange={pickFor} />
              <span className="field-hint">Гроші за групові заняття йдуть тільки на них, за індивідуальні — тільки на індивідуальні.</span>
            </div>
          )}

          <div className="field">
            <span className="field-label">{opening ? 'Скільки оплачених уроків лишалося' : 'За скільки уроків'}</span>
            <div className="count-chips" role="radiogroup" aria-label="Кількість уроків">
              {PACKAGES.map((n) => (
                <button key={n} role="radio" className="chip" aria-checked={count === n} aria-pressed={count === n} onClick={() => pickCount(n)}>
                  {n}
                </button>
              ))}
            </div>
            <span className="field-hint">
              {count ? `${nPlural(count, LESSONS)} × ${money(price)} = ${money(count * price)}` : `Довільна сума · ${money(price)} за урок`}
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
                    setCount(price > 0 && v % price === 0 && v > 0 ? v / price : null);
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

          {offerOpening && (
            <div className="toggle-row switch-card">
              <span>
                <b>Залишок з попереднього періоду</b>
                <small>
                  Гроші прийшли до того, як ви почали вести облік у застосунку. Зарахуються в баланс учня, але не в «Надійшло на рахунок»,
                  податки й звірку з банком.
                </small>
              </span>
              <Switch checked={opening} onChange={toggleOpening} label="Залишок з попереднього періоду" />
            </div>
          )}

          <label className="field">
            <span className="field-label">Примітка (необов'язково)</span>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={opening ? 'Напр.: пакет оплачено у жовтні' : 'Напр.: переказ на картку'}
            />
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
