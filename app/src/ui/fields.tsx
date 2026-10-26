import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CURRENCIES, DURATIONS, STUDENT_COLORS } from '../data/constants';
import type { Currency, ID, Slot, Student } from '../data/types';
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
  currency,
  onPrice,
  onCurrency,
  label = 'Ціна за урок',
}: {
  price: number;
  currency: Currency;
  onPrice: (v: number) => void;
  onCurrency?: (c: Currency) => void;
  label?: string;
}) {
  return (
    <div className="row">
      <label className="field" style={{ flex: 1.4 }}>
        <span className="field-label">{label}</span>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          min={0}
          value={Number.isFinite(price) ? price : ''}
          onChange={(e) => onPrice(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </label>
      {onCurrency ? (
        <label className="field">
          <span className="field-label">Валюта</span>
          <select className="select" value={currency} onChange={(e) => onCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="field" style={{ flex: 0.5 }}>
          <span className="field-label">&nbsp;</span>
          <span className="input" style={{ display: 'grid', placeItems: 'center', fontWeight: 800 }}>
            {CURRENCIES.find((c) => c.code === currency)?.symbol}
          </span>
        </div>
      )}
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
