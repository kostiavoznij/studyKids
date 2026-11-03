import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { owed, termsOf } from '../data/pay';
import { useLiveLessons, useTeachers } from '../data/selectors';
import { useData } from '../data/store';
import type { ID } from '../data/types';
import { todayKey } from '../lib/dates';
import { money } from '../lib/format';
import { Sheet } from '../ui/components';
import { NumberInput } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';

/** Money the school paid a teacher: the amount, when, and what for. */
export function PayoutSheet({ id, teacherId, onClose }: { id?: ID; teacherId?: ID; onClose: () => void }) {
  const existing = useData((s) => (id ? s.teacherPayouts[id] : undefined));
  const payRec = useData((s) => s.teacherPay);
  const payouts = useData((s) => s.teacherPayouts);
  const savePayout = useData((s) => s.savePayout);
  const deletePayout = useData((s) => s.deletePayout);
  const lessons = useLiveLessons();
  const teachers = useTeachers();
  const notify = useUi((s) => s.notify);

  const who = existing?.teacherId ?? teacherId ?? '';
  const teacher = teachers.find((t) => t.id === who);
  // What she's still owed, not counting this very payout when it's being edited.
  const due = owed(lessons, payouts, who, termsOf(payRec, who)) + (existing?.amount ?? 0);
  const [amount, setAmount] = useState(existing?.amount ?? Math.max(0, Math.round(due)));
  const [date, setDate] = useState(existing?.date ?? todayKey());
  const [note, setNote] = useState(existing?.note ?? '');
  const ok = amount > 0 && !!date && date <= todayKey() && !!teacher;

  const save = () => {
    if (!ok) return;
    savePayout({ ...(existing ?? {}), teacherId: who, amount, date, note: note.trim() });
    notify(existing ? 'Виплату змінено' : `Виплату записано: ${teacher?.name}, ${money(amount)}`);
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const yes = await ask({ title: 'Видалити виплату?', text: `${money(existing.amount)} знову рахуватимуться як борг школи перед вчителькою.`, ok: 'Видалити', danger: true });
    if (!yes) return;
    deletePayout(existing.id);
    notify('Виплату видалено');
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Виплата' : `Виплата: ${teacher?.name ?? ''}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!ok} onClick={save}>
          {existing ? 'Зберегти' : 'Записати виплату'}
        </button>
      }
    >
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        {due > 0.5 ? `Борг школи перед вчителькою: ${money(due)}.` : due < -0.5 ? `Виплачено наперед: ${money(-due)}.` : 'Боргу перед вчителькою немає.'}
      </p>
      <div className="row">
        <label className="field">
          <span className="field-label">Сума</span>
          <div className="input-wrap">
            <NumberInput value={amount} onChange={setAmount} label="Сума" />
            <span className="input-suffix">₴</span>
          </div>
        </label>
        <label className="field">
          <span className="field-label">Дата</span>
          <input className="input" type="date" value={date} max={todayKey()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Коментар (необов'язково)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: за жовтень" />
      </label>
      {existing && (
        <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
          <Trash2 size={17} /> Видалити виплату
        </button>
      )}
    </Sheet>
  );
}
