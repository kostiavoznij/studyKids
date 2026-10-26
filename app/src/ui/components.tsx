import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { colorHex } from '../data/constants';
import { useData } from '../data/store';
import type { Currency, Lesson } from '../data/types';
import { initials, money } from '../lib/format';
import { useUi } from './uiStore';

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const style = { '--c': colorHex(color), width: size, height: size, fontSize: Math.round(size * 0.38) } as CSSProperties;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Money({ value, currency }: { value: number; currency?: Currency }) {
  const base = useData((s) => s.settings.baseCurrency);
  return <>{money(value, currency ?? base)}</>;
}

export function Delta({ pct, upIsGood = true, suffix }: { pct: number | null; upIsGood?: boolean; suffix?: string }) {
  if (pct == null) return null;
  const tone = pct === 0 ? 'flat' : pct > 0 === upIsGood ? 'good' : 'bad';
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${tone}`}>
      <Icon size={14} strokeWidth={2.6} aria-hidden="true" />
      {pct > 0 ? '+' : ''}
      {pct}%{suffix ? <span className="faint" style={{ fontWeight: 600 }}>&nbsp;{suffix}</span> : null}
    </span>
  );
}

export function Tile({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub != null && <div className="tile-sub">{sub}</div>}
    </>
  );
  return onClick ? (
    <button className="tile" style={{ textAlign: 'left' }} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="tile">{body}</div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 700, color: 'var(--text-2)' }}>{title}</div>
      {children}
    </div>
  );
}

const GRADE_WORDS = ['', 'Важко', 'Слабо', 'Нормально', 'Добре', 'Чудово'];

export function GradePicker({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className="grade-picker">
      <div className="grade-dots" role="radiogroup" aria-label="Засвоєння">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            data-on={value != null && n <= value ? '' : undefined}
            onClick={() => onChange(value === n ? undefined : n)}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="faint" style={{ fontSize: 13, fontWeight: 650 }}>
        {value ? GRADE_WORDS[value] : 'Не оцінено'}
      </span>
    </div>
  );
}

export function GradeMini({ value }: { value?: number | null }) {
  if (value == null) return null;
  return (
    <span className="grade-mini" aria-label={`Засвоєння ${value} з 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} data-on={n <= Math.round(value) ? '' : undefined} />
      ))}
    </span>
  );
}

export function StatusBadge({ lesson, now }: { lesson: Lesson; now: string }) {
  if (lesson.status === 'done') return <span className="badge good">Проведено</span>;
  if (lesson.status === 'cancelled') return <span className="badge bad">Скасовано</span>;
  if (lesson.start < now) return <span className="badge warn">Не відмічено</span>;
  if (lesson.moves.length) return <span className="badge accent">Перенесено</span>;
  return <span className="badge">Заплановано</span>;
}

/* ---------- Sheet ---------- */

const desktop = () => window.matchMedia('(min-width: 900px)').matches;

export function Sheet({
  title,
  onClose,
  children,
  footer,
  headExtra,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headExtra?: ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; dy: number; t0: number } | null>(null);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    sheet.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // Drag the grip or header down to dismiss (phone only).
  const onDown = (e: ReactPointerEvent) => {
    if (desktop() || (e.target as HTMLElement).closest('button, input, textarea, select')) return;
    drag.current = { y0: e.clientY, dy: 0, t0: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sheet.current) sheet.current.style.transition = 'none';
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !sheet.current) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    sheet.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > 120 || (d.dy > 40 && velocity > 0.6)) {
      requestClose();
    } else {
      sheet.current.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.25, 1)';
      sheet.current.style.transform = '';
    }
  };
  const dragProps = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  return createPortal(
    <div className="sheet-root" data-closing={closing ? '' : undefined}>
      <div className="sheet-backdrop" onClick={requestClose} />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="sheet-grip" {...dragProps} />
        <div className="sheet-head" {...dragProps}>
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {headExtra}
          <button className="icon-btn" onClick={requestClose} aria-label="Закрити">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Toast & confirm ---------- */

export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, toast.undo ? 5000 : 2800);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id} role="status">
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            dismiss();
          }}
        >
          Повернути
        </button>
      )}
    </div>
  );
}

export function ConfirmHost() {
  const c = useUi((s) => s.confirm);
  if (!c) return null;
  return createPortal(
    <div className="dialog-root">
      <div className="sheet-backdrop" onClick={() => c.resolve(false)} />
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h2>{c.title}</h2>
        {c.text && <p>{c.text}</p>}
        <div className="row">
          <button className="btn btn-ghost" onClick={() => c.resolve(false)}>
            Ні
          </button>
          <button className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => c.resolve(true)} autoFocus>
            {c.ok}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Hooks ---------- */

/** Element width that follows resizes — charts draw to it. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Current local time, refreshed every minute (for the "now" line and statuses). */
export function useNow(): string {
  const [now, setNow] = useState(() => stampNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(stampNow()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function stampNow() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Horizontal swipe on an element: calls onSwipe(-1) for left, +1 for right. */
export function useSwipe(onSwipe: (dir: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
