// 店舗設定：WEB で同じ時間に受ける人数（新規・再来・合わせて）。シフトの担当できる人数からの足し引きで調整し、
// 今日のシフトなら・全員出勤なら何人取れるかと、組み合わせの例をその場で出す
export interface CapRaw { date: string; firstAm: number | null; firstPm: number | null; revisitAm: number | null; revisitPm: number | null; eitherAm: number | null; eitherPm: number | null; slotsAm?: number; slotsPm?: number }
export interface CapAll { first: number | null; revisit: number | null; either: number | null; slots?: number }
export interface Adjust { newAdjust: number; revisitAdjust: number; totalAdjust: number }

const eff = (raw: number | null, d: number) => (raw === null ? null : Math.max(0, raw + d));
/** 新規・再来・合わせての上限（null＝上限なし）。合わせては枠数（シフトの施術者の人数）より多くならない */
function limits(first: number | null, revisit: number | null, either: number | null, a: Adjust, slots?: number) {
  const cap = (v: number | null) => (v === null || slots === undefined ? v : Math.min(v, slots));
  const n = cap(eff(first, a.newAdjust)), r = cap(eff(revisit, a.revisitAdjust)), t0 = eff(either, a.totalAdjust);
  const t = cap(t0 === null ? (n === null || r === null ? null : n + r) : n === null || r === null ? t0 : Math.min(t0, n + r));
  const over = slots !== undefined && ((t0 ?? 0) > slots || (eff(first, a.newAdjust) ?? 0) > slots || (eff(revisit, a.revisitAdjust) ?? 0) > slots);
  return { n, r, t, over };
}
const sign = (v: number) => (v > 0 ? `＋${v}` : v < 0 ? `－${-v}` : '±0');
const num = (v: number | null) => (v === null ? '制限なし' : `${v} 人`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

function Stepper({ label, value, base, onChange }: { label: string; value: number; base: string; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <b className="w-14">{label}</b>
      <button type="button" onClick={() => onChange(Math.max(-20, value - 1))} aria-label={`${label}を 1 人減らす`} className="h-7 w-7 rounded border bg-white text-base leading-none">－</button>
      <span className={`w-10 text-center font-bold tabular-nums ${value === 0 ? 'text-slate-500' : 'text-brand-dark'}`} aria-label={`${label}の調整`}>{sign(value)}</span>
      <button type="button" onClick={() => onChange(Math.min(20, value + 1))} aria-label={`${label}を 1 人増やす`} className="h-7 w-7 rounded border bg-white text-base leading-none">＋</button>
      <span className="text-xs text-slate-500">（{base}）</span>
    </span>
  );
}

export default function WebConcurrentEditor({ value, onChange, capToday, capAll }: { value: Adjust; onChange: (v: Adjust) => void; capToday: CapRaw; capAll: CapAll }) {
  const uses = capAll.first !== null || capAll.revisit !== null;
  const am = limits(capToday.firstAm, capToday.revisitAm, capToday.eitherAm, value, capToday.slotsAm);
  const pm = limits(capToday.firstPm, capToday.revisitPm, capToday.eitherPm, value, capToday.slotsPm);
  const all = limits(capAll.first, capAll.revisit, capAll.either, value, capAll.slots);
  const line = (x: { n: number | null; r: number | null; t: number | null }) => <>新規 {num(x.n)}・再来 {num(x.r)}・合わせて {num(x.t)}</>;
  const sameHalf = am.n === pm.n && am.r === pm.r && am.t === pm.t;
  // 組み合わせの例：今日の午前（午前の担当できる人がいなければ午後）
  const ex = (am.t ?? 0) > 0 || pm.t === null ? am : pm;
  const combos: [number, number][] = [];
  if (ex.n !== null && ex.r !== null && ex.t !== null) for (let n = Math.min(ex.n, ex.t); n >= 0; n--) { const r = Math.min(ex.r, ex.t - n); if (r >= 0) combos.push([n, r]); }
  const set = (k: keyof Adjust) => (v: number) => onChange({ ...value, [k]: v });

  return (
    <div className="rounded border p-3 text-sm" role="group" aria-label="WEB で同時に受ける人数">
      <h3 className="font-bold">WEB で同時に受ける人数</h3>
      {!uses ? (
        <p className="mt-1 text-xs text-slate-600">スタッフの「初回を担当する」「再来を担当する」にチェックを付けると、その人数をもとに、同じ時間に WEB で受ける新規・再来の人数が決まります（今はチェックが無いので、WEB解放ベッド数・シフトの人数までです）。</p>
      ) : (<>
        <p className="mt-1 text-xs text-slate-600">ふだんはシフトに入っているスタッフの人数で決まります（1 人が 1 人の患者様を受ける）。「＋」「－」で、その人数より多く・少なくできます（休みの日はスタッフの人数に合わせて自動で減ります）。</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          <Stepper label="新規" value={value.newAdjust} base="初回を担当する人数から" onChange={set('newAdjust')} />
          <Stepper label="再来" value={value.revisitAdjust} base="再来を担当する人数から" onChange={set('revisitAdjust')} />
          <Stepper label="合わせて" value={value.totalAdjust} base="初回か再来を担当する人数から" onChange={set('totalAdjust')} />
        </div>
        <div className="mt-3 rounded border border-sky-200 bg-brand-light px-3 py-2" aria-live="polite">
          <p><span className="text-xs text-slate-600">今日（{md(capToday.date)}）のシフトなら</span><br />
            <b className="text-base text-brand-dark">{sameHalf ? <>午前・午後とも {line(am)}</> : <>午前 {line(am)}<br />午後 {line(pm)}</>}</b></p>
          <p className="mt-1 text-xs text-slate-600">全員出勤の日なら：{line(all)}</p>
          {combos.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-slate-600">同じ時間に取れる組み合わせ（今日の{ex === am ? '午前' : '午後'}）</p>
              <table className="mt-1 border-collapse text-xs" aria-label="組み合わせの例">
                <thead><tr className="bg-white">{['新規', '再来', '合計'].map((h) => <th key={h} className="border border-sky-200 px-3 py-0.5">{h}</th>)}</tr></thead>
                <tbody>{combos.map(([n, r]) => <tr key={n} className="bg-white text-center tabular-nums"><td className="border border-sky-200 px-3">{n}</td><td className="border border-sky-200 px-3">{r}</td><td className="border border-sky-200 px-3">{n + r}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        {(am.over || pm.over || all.over) && <p className="mt-1 text-xs text-amber-700">※ 同じ時間に WEB で取れる合計は、その日の枠数（シフトに入っている施術者の人数。今日は午前 {capToday.slotsAm}・午後 {capToday.slotsPm}）までです。それより多く取りたいときは、予約表の「枠数・ブロック」でその日の枠数を増やしてください。</p>}
        <p className="mt-1 text-xs text-slate-500">「－」で 0 人になった区分は、その時間 WEB では取れません（×）。電話で予約表に入れるのは、人数に関係なくできます。その日の人数は予約表の「WEB の同時上限」にも出ます。</p>
      </>)}
    </div>
  );
}
