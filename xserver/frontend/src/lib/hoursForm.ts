// 営業時間の設定（JSON）と、画面の入力（終了時刻で入力）を相互に変換する。純粋関数
// 設定の [開始, 最終枠の開始] ⇔ 画面の [開始, 終了]（終了＝最終枠の開始＋枠の長さ）
export type Range = [string, string] | null;
export interface DayForm { closed: boolean; am: Range; pm: Range }
export interface PeriodForm { from: string; to: string; days: Record<string, DayForm> }
export const WEEK_ORDER = ['1', '2', '3', '4', '5', '6', '0'];
export const WEEK_LABEL: Record<string, string> = { '0': '日', '1': '月', '2': '火', '3': '水', '4': '木', '5': '金', '6': '土' };

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const norm = (hm: string) => toHm(toMin(hm));

export function emptyDays(): Record<string, DayForm> {
  return Object.fromEntries(WEEK_ORDER.map((d) => [d, { closed: true, am: null, pm: null }]));
}

/** JSON → 画面。3 つ以上の時間帯がある日は扱えないので null（JSON で編集してもらう） */
export function toForm(json: string, slot: number): PeriodForm[] | null {
  if (!json.trim()) return [];
  let cfg: { periods?: { from?: string; to?: string; byWeekday?: Record<string, [string, string][]> }[] };
  try { cfg = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(cfg.periods)) return null;
  const out: PeriodForm[] = [];
  for (const p of cfg.periods) {
    const days = emptyDays();
    for (const d of WEEK_ORDER) {
      const ss = [...(p.byWeekday?.[d] ?? [])].sort((a, b) => toMin(a[0]) - toMin(b[0]));
      if (ss.length > 2) return null;
      if (ss.length === 0) continue;
      const r = (s: [string, string]): Range => [norm(s[0]), toHm(toMin(s[1]) + slot)];
      const am = ss.find((s) => toMin(s[0]) < 12 * 60);
      const pm = ss.find((s) => s !== am);
      days[d] = { closed: false, am: am ? r(am) : null, pm: pm ? r(pm) : null };
    }
    out.push({ from: p.from ?? '', to: p.to ?? '', days });
  }
  return out;
}

/** 画面 → JSON。入力の誤りがあれば error を返す */
export function toJson(periods: PeriodForm[], slot: number): { json: string; error?: string } {
  if (periods.length === 0) return { json: '' };
  const res = [];
  for (const [i, p] of periods.entries()) {
    if (p.from && p.to && p.from > p.to) return { json: '', error: `期間${i + 1}：開始日が終了日より後になっています` };
    const byWeekday: Record<string, [string, string][]> = {};
    for (const d of WEEK_ORDER) {
      const day = p.days[d];
      const ss: [string, string][] = [];
      if (!day.closed) {
        for (const [label, r] of [['午前', day.am], ['午後', day.pm]] as const) {
          if (!r || (!r[0] && !r[1])) continue;
          if (!r[0] || !r[1]) return { json: '', error: `期間${i + 1}・${WEEK_LABEL[d]}曜：${label}の開始と終了を両方入れてください` };
          if (toMin(r[1]) - slot < toMin(r[0])) return { json: '', error: `期間${i + 1}・${WEEK_LABEL[d]}曜：${label}の終了は開始より ${slot} 分以上あとにしてください` };
          ss.push([norm(r[0]), toHm(toMin(r[1]) - slot)]);
        }
      }
      byWeekday[d] = ss;
    }
    res.push({ ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), byWeekday });
  }
  return { json: JSON.stringify({ periods: res }, null, 2) };
}
