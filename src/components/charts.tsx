import { useMemo, useRef, useState } from 'react';
import { formatMoney } from '../lib/money';

interface Point { date: string; value: number }

/** Single-series balance line with a crosshair + tooltip. */
export function BalanceChart({ points, currency = 'USD', label }: { points: Point[]; currency?: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640, H = 200, P = { l: 56, r: 12, t: 12, b: 24 };

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t = points.map((p) => new Date(p.date).getTime());
    const v = points.map((p) => p.value);
    let lo = Math.min(...v, 0), hi = Math.max(...v);
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    hi += pad; if (lo < 0) lo -= pad;
    const x = (ms: number) => P.l + ((ms - t[0]) / (t[t.length - 1] - t[0] || 1)) * (W - P.l - P.r);
    const y = (val: number) => P.t + (1 - (val - lo) / (hi - lo)) * (H - P.t - P.b);
    const ticks = [lo, (lo + hi) / 2, hi].map((val) => ({ val, y: y(val) }));
    const xy = points.map((p, i) => ({ x: x(t[i]), y: y(p.value), p }));
    return { xy, ticks, zeroY: lo < 0 ? y(0) : null, path: xy.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ') };
  }, [points]);

  if (!geo) return <p className="muted small">Import at least two statements to see your balance over time.</p>;

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    geo.xy.forEach((q, i) => { if (Math.abs(q.x - mx) < Math.abs(geo.xy[best].x - mx)) best = i; });
    setHover(best);
  };
  const h = hover !== null ? geo.xy[hover] : null;

  return (
    <figure className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {geo.ticks.map((tk, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={tk.y} y2={tk.y} className="grid" />
            <text x={P.l - 6} y={tk.y + 4} textAnchor="end" className="axis">{compact(tk.val, currency)}</text>
          </g>
        ))}
        {geo.zeroY !== null && <line x1={P.l} x2={W - P.r} y1={geo.zeroY} y2={geo.zeroY} className="zero" />}
        <text x={P.l} y={H - 6} className="axis">{points[0].date}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="axis">{points[points.length - 1].date}</text>
        <path d={geo.path} className="line" />
        {h && (
          <>
            <line x1={h.x} x2={h.x} y1={P.t} y2={H - P.b} className="crosshair" />
            <circle cx={h.x} cy={h.y} r={5} className="dot" />
          </>
        )}
        <rect x={P.l} y={0} width={W - P.l - P.r} height={H} fill="transparent" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 100}%` }}>
          <div className="muted small">{h.p.date}</div>
          <strong>{formatMoney(h.p.value, currency)}</strong>
        </div>
      )}
      <details className="table-view">
        <summary>Show as table</summary>
        <table className="table"><tbody>
          {points.map((p) => <tr key={p.date}><td>{p.date}</td><td className="num">{formatMoney(p.value, currency)}</td></tr>)}
        </tbody></table>
      </details>
    </figure>
  );
}

function compact(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Horizontal magnitude bars, one hue, values as text. Optional comparison tick (e.g. last month). */
export function CategoryBars({ rows, currency = 'USD', onSelect }: {
  rows: { label: string; value: number; compare?: number }[];
  currency?: string;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.compare ?? 0)), 1);
  return (
    <ul className="bars">
      {rows.map((r) => {
        const diff = r.compare !== undefined ? r.value - r.compare : undefined;
        return (
          <li key={r.label}>
            <button className="bar-row" onClick={() => onSelect?.(r.label)} title={`${r.label}: ${formatMoney(r.value, currency)}${r.compare !== undefined ? ` (last month ${formatMoney(r.compare, currency)})` : ''}`}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
                {r.compare !== undefined && r.compare > 0 && <span className="bar-compare" style={{ left: `${(r.compare / max) * 100}%` }} />}
              </span>
              <span className="bar-value">
                {formatMoney(r.value, currency)}
                {diff !== undefined && Math.abs(diff) >= 1 && (
                  <span className={`small ${diff > 0 ? 'up' : 'down'}`}> {diff > 0 ? '▲' : '▼'} {formatMoney(Math.abs(diff), currency)}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
