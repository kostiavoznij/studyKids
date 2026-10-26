import { useState } from 'react';
import { useWidth } from './components';

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  /** full label for the tooltip and table, e.g. «Жовтень 2026» */
  title: string;
  highlight?: boolean;
}

function niceScale(max: number, ticks = 3) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { top: step * ticks, step };
}

/** Bar with a 4px rounded data end and a square baseline. */
function barPath(x: number, y: number, w: number, base: number) {
  const h = base - y;
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

export function ColumnChart({
  data,
  format,
  tickFormat = format,
  height = 190,
  label,
}: {
  data: ColumnDatum[];
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const padL = 46;
  const padR = 6;
  const padT = 24;
  const padB = 26;
  const n = data.length;
  const { top, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const plotW = Math.max(0, width - padL - padR);
  const band = n ? plotW / n : 0;
  const barW = Math.min(24, band * 0.62);
  const base = height - padB;
  const y = (v: number) => padT + (base - padT) * (1 - v / top);
  const labelEvery = band < 30 ? Math.ceil(30 / Math.max(band, 1)) : 1;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const tip = active != null ? data[active] : null;

  return (
    <div className="chart">
      <div ref={ref} className="chart-plot" style={{ height }} onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'gridline'} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                  {tickFormat(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + band * i + band / 2;
              const on = d.highlight || active === i;
              return (
                <g key={d.key}>
                  <path
                    d={barPath(cx - barW / 2, y(d.value), barW, base)}
                    fill={on ? 'var(--accent)' : 'var(--accent-mute)'}
                    className="bar"
                  />
                  {d.highlight && d.value > 0 && <CapLabel cx={cx} y={y(d.value) - 7} text={format(d.value)} width={width} barW={barW} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={height - 8} textAnchor="middle" className={d.highlight ? 'tick strong' : 'tick'}>
                      {d.label}
                    </text>
                  )}
                  <rect
                    x={padL + band * i}
                    y={0}
                    width={band}
                    height={height}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.title}: ${format(d.value)}`}
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {tip && active != null && (
          <div
            className="chart-tip"
            style={{
              left: Math.min(Math.max(padL + band * active + band / 2, 70), width - 70),
              top: Math.max(0, y(tip.value) - 54),
            }}
          >
            <strong>{format(tip.value)}</strong>
            <span>{tip.title}</span>
          </div>
        )}
      </div>
      <button className="chart-table-toggle" onClick={() => setTable((v) => !v)}>
        {table ? 'Сховати таблицю' : 'Показати таблицею'}
      </button>
      {table && (
        <table className="chart-table">
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.title}</td>
                <td className="num">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Value on top of a bar; near the edges it aligns to the bar instead of overflowing. */
function CapLabel({ cx, y, text, width, barW }: { cx: number; y: number; text: string; width: number; barW: number }) {
  const half = text.length * 3.6;
  const anchor = cx + half > width ? 'end' : cx - half < 0 ? 'start' : 'middle';
  const x = anchor === 'end' ? cx + barW / 2 : anchor === 'start' ? cx - barW / 2 : cx;
  return (
    <text x={x} y={y} textAnchor={anchor} className="cap-label">
      {text}
    </text>
  );
}

export interface LinePoint {
  key: string;
  label: string;
  title: string;
  value: number | null;
}

/** Fixed 1–5 scale line for the understanding grade. */
export function GradeLine({ data, height = 170, label }: { data: LinePoint[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const padL = 30;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const n = data.length;
  const plotW = Math.max(0, width - padL - padR);
  const x = (i: number) => padL + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);
  const y = (v: number) => padT + (height - padT - padB) * (1 - (v - 1) / 4);

  // Break the line where a month has no grades.
  const segments: string[] = [];
  let cur = '';
  data.forEach((d, i) => {
    if (d.value == null) {
      if (cur) segments.push(cur);
      cur = '';
    } else {
      cur += `${cur ? 'L' : 'M'}${x(i)},${y(d.value)}`;
    }
  });
  if (cur) segments.push(cur);

  const nearest = (clientX: number, el: Element) => {
    const left = el.getBoundingClientRect().left;
    const i = Math.round(((clientX - left - padL) / Math.max(plotW, 1)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };
  const tip = active != null ? data[active] : null;
  const labelEvery = plotW / Math.max(n, 1) < 30 ? 2 : 1;

  return (
    <div className="chart">
      <div
        ref={ref}
        className="chart-plot"
        style={{ height }}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            {[1, 2, 3, 4, 5].map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} className={t === 1 ? 'axis' : 'gridline'} />
                <text x={padL - 10} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                  {t}
                </text>
              </g>
            ))}
            {active != null && <line x1={x(active)} x2={x(active)} y1={padT} y2={height - padB} className="crosshair" />}
            {segments.map((d, i) => (
              <path key={i} d={d} className="line" />
            ))}
            {data.map((d, i) =>
              d.value == null ? null : <circle key={d.key} cx={x(i)} cy={y(d.value)} r={active === i ? 5.5 : 4} className="dot-mark" />,
            )}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d.key} x={x(i)} y={height - 8} textAnchor="middle" className="tick">
                  {d.label}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {tip && active != null && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(x(active), 60), width - 60), top: 0 }}>
            <strong>{tip.value == null ? 'немає оцінок' : tip.value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}</strong>
            <span>{tip.title}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export interface StackPart {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Proportion bar with a 2px surface gap between parts, legend always shown. */
export function StackBar({ parts }: { parts: StackPart[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        {total === 0 ? (
          <span style={{ flex: 1, background: 'var(--surface-3)' }} />
        ) : (
          visible.map((p) => <span key={p.key} style={{ flex: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />)
        )}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} />
            {p.label}
            <b className="num">{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
