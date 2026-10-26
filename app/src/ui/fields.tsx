import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DURATIONS, STUDENT_COLORS } from '../data/constants';
import type { Billing, ID, Slot, Student } from '../data/types';
import { WEEKDAYS_LONG, cap } from '../lib/dates';
import { uid } from '../lib/format';
import { Avatar } from './components';

/**
 * Text field that keeps typing local and commits to the store after a pause and
 * on unmount — persisting the whole dataset on every keystroke is too slow on a phone.
 */
export function DraftField({
  value,
  onCommit,
  multiline,
  placeholder,
  rows = 3,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  label: string;
}) {
  const [v, setV] = useState(value);
  const latest = useRef(v);
  const committed = useRef(value);
  const commitRef = useRef(onCommit);
  latest.current = v;
  commitRef.current = onCommit;

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setV(value);
    }
  }, [value]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (latest.current !== committed.current) {
        committed.current = latest.current;
        commitRef.current(latest.current);
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [v]);

  useEffect(
    () => () => {
      if (latest.current !== committed.current) commitRef.current(latest.current);
    },
    [],
  );

  const common = {
    value: v,
    placeholder,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => {
      if (latest.current !== committed.current) {
        committed.current = latest.current;
        commitRef.current(latest.current);
      }
    },
  };
  return multiline ? <textarea className="textarea" rows={rows} {...common} /> : <input className="input" {...common} />;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Колір">
      {STUDENT_COLORS.map((c) => (
        <button
          key={c.key}
          role="radio"
          aria-checked={c.key === value}
          aria-label={c.key}
          style={{ '--c': c.hex } as CSSProperties}
          onClick={() => onChange(c.key)}
        />
      ))}
    </div>
  );
}

export function DurationChips({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="chips">
      {DURATIONS.map((d) => (
        <button key={d} className="chip" aria-pressed={d === value} onClick={() => onChange(d)}>
          {d === 60 ? '1 год' : d === 90 ? '1,5 год' : `${d} хв`}
        </button>
      ))}
    </div>
  );
}

export function PriceField({
  price,
  onPrice,
  label = 'Ціна за урок',
}: {
  price: number;
  onPrice: (v: number) => void;
  label?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          value={Number.isFinite(price) ? price : ''}
          onChange={(e) => onPrice(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        <span className="input-suffix">₴</span>
      </span>
    </label>
  );
}

export const BILLINGS: { value: Billing; label: string; hint: string }[] = [
  { value: 'prepaid', label: 'Наперед, пакетом', hint: 'Батьки платять за кілька уроків одразу — застосунок рахує, скільки ще оплачено' },
  { value: 'after', label: 'Після кожного уроку', hint: 'Оплата за кожен урок окремо — у картці уроку є кнопка «Оплатили»' },
];

export function BillingPicker({ value, onChange }: { value: Billing; onChange: (b: Billing) => void }) {
  return (
    <div className="billing-picker" role="radiogroup" aria-label="Як платять">
      {BILLINGS.map((b) => (
        <button key={b.value} role="radio" aria-checked={value === b.value} onClick={() => onChange(b.value)}>
          <b>{b.label}</b>
          <span>{b.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function SlotEditor({ slots, onChange, duration }: { slots: Slot[]; onChange: (s: Slot[]) => void; duration: number }) {
  const update = (id: string, patch: Partial<Slot>) => onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <div className="slots">
      {slots.map((s) => (
        <div key={s.id} className="slot-row">
          <select className="select" value={s.weekday} onChange={(e) => update(s.id, { weekday: Number(e.target.value) })} aria-label="День тижня">
            {WEEKDAYS_LONG.map((w, i) => (
              <option key={w} value={i + 1}>
                {cap(w)}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="time"
            step={900}
            value={s.time}
            onChange={(e) => e.target.value && update(s.id, { time: e.target.value })}
            aria-label="Час"
          />
          <button className="icon-btn" onClick={() => onChange(slots.filter((x) => x.id !== s.id))} aria-label="Прибрати день">
            <Trash2 size={18} />
          </button>
        </div>
      ))}
      <button
        className="btn btn-soft btn-sm"
        onClick={() => {
          const last = slots[slots.length - 1];
          onChange([...slots, { id: uid(), weekday: last ? (last.weekday % 7) + 1 : 1, time: last?.time ?? '15:00', duration }]);
        }}
      >
        <Plus size={16} /> Додати день
      </button>
    </div>
  );
}

export function StudentChips({
  students,
  selected,
  onToggle,
}: {
  students: Student[];
  selected: ID[];
  onToggle: (id: ID) => void;
}) {
  return (
    <div className="student-chips">
      {students.map((s) => (
        <button key={s.id} className="student-chip" aria-pressed={selected.includes(s.id)} onClick={() => onToggle(s.id)}>
          <Avatar name={s.name} color={s.color} size={26} />
          {s.name}
        </button>
      ))}
    </div>
  );
}
