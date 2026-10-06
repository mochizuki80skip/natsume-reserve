// 小さなグラフ部品（SVG）。マウスを乗せると数値を表示する
import { useEffect, useRef, useState } from 'react';

/** 親の幅に合わせて描くための幅 */
function useWidth(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}
const short = (s: string, n = 7) => (s.length > n ? `${s.slice(0, n)}…` : s);

// 色の順番（固定。並べ替えで色が変わらないよう、項目の並び順に割り当てる）
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const OTHER_COLOR = '#94a3b8';
const GRID = '#eef2f6';
const AXIS = '#94a3b8';

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white shadow" style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}>
      {children}
    </div>
  );
}

export interface LineSeries { name: string; color: string; values: (number | null)[]; bold?: boolean; counts?: string[] }
/** 継続率の線グラフ（0〜100%） */
export function PercentLines({ xLabels, series, height = 230 }: { xLabels: string[]; series: LineSeries[]; height?: number }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [ref, width] = useWidth(300);
  const L = 36, R = 104, T = 10, B = 22;
  const n = xLabels.length;
  const x = (i: number) => L + ((width - L - R) * i) / Math.max(1, n - 1);
  const y = (v: number) => T + (height - T - B) * (1 - v / 100);
  // 右端のラベル（重ならないようにずらす）
  const ends = series.map((s) => ({ s, v: [...s.values].reverse().find((v) => v !== null) ?? null })).filter((e) => e.v !== null) as { s: LineSeries; v: number }[];
  ends.sort((a, b) => b.v - a.v);
  let last = -99;
  const endY = new Map<string, number>();
  for (const e of ends) { let yy = y(e.v) + 4; if (yy - last < 12) yy = last + 12; last = yy; endY.set(e.s.name, yy); }
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="継続率のグラフ">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}><line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={L - 5} y={y(v) + 3} fontSize={9} fill={AXIS} textAnchor="end">{v}%</text></g>
        ))}
        {xLabels.map((l, i) => <text key={l} x={x(i)} y={height - 6} fontSize={9.5} fill={AXIS} textAnchor="middle">{l}</text>)}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
          return (
            <g key={s.name}>
              <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={s.bold ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="#fff" strokeWidth={2}
                  onMouseEnter={() => setHover({ x: x(i), y: y(v), text: `${s.name}　${xLabels[i]} ${v}%${s.counts?.[i] ? `（${s.counts[i]}）` : ''}` })} onMouseLeave={() => setHover(null)} />
              ))}
              {endY.has(s.name) && <text x={width - R + 8} y={endY.get(s.name)} fontSize={10} fill="#334155">{short(s.name)} {[...s.values].reverse().find((v) => v !== null)}%</text>}
            </g>
          );
        })}
      </svg>
      {hover && <Tip x={hover.x} y={hover.y}>{hover.text}</Tip>}
    </div>
  );
}

/** 積み上げ縦棒（新患・初自・再来の推移など） */
export function StackedColumns({ labels, series, height = 200, titleOf }: {
  labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number; titleOf?: (i: number) => string;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  const [ref, boxW] = useWidth(320);
  const width = Math.max(boxW, labels.length * 22 + 40);
  const L = 30, B = 22, T = 10;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(4, ...totals);
  const step = max <= 8 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : 20;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (height - T - B) * (1 - v / top);
  const bw = (width - L) / labels.length;
  const w = Math.min(24, bw * 0.6);
  return (
    <div ref={ref} className="relative w-full overflow-x-auto">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} role="img" aria-label="推移のグラフ">
          {Array.from({ length: top / step + 1 }, (_, k) => k * step).map((v) => (
            <g key={v}><line x1={L} x2={width} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={L - 5} y={y(v) + 3} fontSize={9} fill={AXIS} textAnchor="end">{v}</text></g>
          ))}
          {labels.map((l, i) => {
            const cx = L + bw * i + bw / 2;
            let acc = 0;
            return (
              <g key={i} onMouseEnter={() => setHover({ x: cx, y: y(totals[i]), i })} onMouseLeave={() => setHover(null)}>
                <rect x={L + bw * i} y={T} width={bw} height={height - T - B} fill="transparent" />
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (!v) return null;
                  const y1 = y(acc + v), y0 = y(acc);
                  acc += v;
                  return <rect key={s.name} x={cx - w / 2} y={y1 + 1} width={w} height={Math.max(1, y0 - y1 - 2)} rx={2} fill={s.color} />;
                })}
                <text x={cx} y={height - 6} fontSize={9.5} fill={AXIS} textAnchor="middle">{l}</text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <Tip x={hover.x} y={hover.y}>
            {titleOf ? titleOf(hover.i) : labels[hover.i]}　{series.map((s) => `${s.name} ${s.values[hover.i] ?? 0}`).join('・')}　計 {totals[hover.i]}
          </Tip>
        )}
      </div>
    </div>
  );
}

/** ドーナツ（割合）。項目が多いときは上位だけ色を付け、残りは「その他」にまとめる */
export function Donut({ items, center, size = 190 }: { items: { label: string; value: number }[]; center: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = items.filter((i) => i.value > 0);
  const shown = sorted.length > SERIES_COLORS.length ? sorted.slice(0, SERIES_COLORS.length - 1) : sorted;
  const rest = sorted.slice(shown.length).reduce((a, b) => a + b.value, 0);
  const parts = [...shown.map((s, i) => ({ ...s, color: SERIES_COLORS[i] })), ...(rest > 0 ? [{ label: 'その他（まとめ）', value: rest, color: OTHER_COLOR }] : [])];
  const total = parts.reduce((a, b) => a + b.value, 0);
  const c = size / 2, R = size / 2 - 4, r = R * 0.56;
  let ang = -Math.PI / 2;
  const P = (rad: number, a: number) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <svg width={size} height={size} role="img" aria-label="割合のグラフ">
        {total === 0 && <circle cx={c} cy={c} r={(R + r) / 2} fill="none" stroke={GRID} strokeWidth={R - r} />}
        {parts.map((p, i) => {
          const a2 = ang + (2 * Math.PI * p.value) / total;
          const large = a2 - ang > Math.PI ? 1 : 0;
          const full = p.value === total;
          const [x1, y1] = P(R, ang), [x2, y2] = P(R, full ? a2 - 0.0001 : a2), [x3, y3] = P(r, full ? a2 - 0.0001 : a2), [x4, y4] = P(r, ang);
          const d = `M${x1} ${y1}A${R} ${R} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`;
          ang = a2;
          return <path key={i} d={d} fill={p.color} stroke="#fff" strokeWidth={2} opacity={hover === null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />;
        })}
        <text x={c} y={c - 3} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1e293b">{hover === null ? total : parts[hover].value}</text>
        <text x={c} y={c + 15} textAnchor="middle" fontSize={10.5} fill="#64748b">{hover === null ? center : parts[hover].label}</text>
      </svg>
      <ul className="space-y-0.5 text-xs">
        {parts.map((p, i) => (
          <li key={p.label} className={`flex items-center gap-1.5 ${hover === i ? 'font-bold' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}<b className="ml-1">{p.value}</b><span className="text-slate-500">（{Math.round((p.value / total) * 100)}%）</span>
          </li>
        ))}
        {total === 0 && <li className="text-slate-400">データがありません</li>}
      </ul>
    </div>
  );
}
