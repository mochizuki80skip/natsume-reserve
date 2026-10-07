// SNS 投稿管理：サーバー（PHP API）が返すデータの型と、画面で使う小さな関数
import { WEEKDAY_JA, addDays, weekdayOf } from './time';

export type Channel = 'ig' | 'gbp';
export type PostStatus = 'draft' | 'approved' | 'publishing' | 'posted' | 'failed';
export const CHANNELS: Channel[] = ['ig', 'gbp'];
export const CHANNEL_JA: Record<Channel, string> = { ig: 'Instagram', gbp: 'Google' };
export const STATUS_JA: Record<PostStatus, string> = { draft: '確認待ち', approved: '承認済み', publishing: '投稿中', posted: '投稿済み', failed: '失敗' };
export const STATUS_CLASS: Record<PostStatus, string> = {
  draft: 'bg-amber-100 text-amber-800', approved: 'bg-blue-100 text-blue-800', publishing: 'bg-amber-100 text-amber-800', posted: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800',
};

export type Schedule = { type: 'weekly'; weekdays: number[]; hour: number; minute: number } | { type: 'monthly'; nth: number; weekday: number; hour: number; minute: number };

export interface PostStat { reach: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null; views: number | null; fetchedAt: string }
export interface Post {
  id: string; storeId: string; storeCode: string | null; storeName: string | null; channel: Channel; scheduledAt: string; status: PostStatus; topicId: string | null;
  title: string; body: string; closing: string; hashtags: string; fullText: string; patternIdx: number;
  imageUrl: string | null; imageKind: 'none' | 'template' | 'upload' | 'topic' | 'library'; source: 'auto' | 'manual'; publishMode: 'api' | 'manual';
  approvedAt: string | null; approvedBy: string | null; postedAt: string | null; externalId: string | null; permalink: string | null; error: string | null;
  length: number; maxLength: number; compliance: { hits: string[]; blocking: boolean }; stat: PostStat | null; createdAt: string; updatedAt: string;
  standalone: boolean; unfilled: string[]; gbpInfo: string[];
}
export interface Media { id: string; shared: boolean; url: string; label: string; channel: Channel | 'both'; width: number; height: number; active: boolean; useCount: number; lastUsedAt: string | null; createdAt: string }
export const IMAGE_KIND_JA: Record<Post['imageKind'], string> = { none: 'なし', template: '定型画像', upload: '写真', topic: '定型投稿の画像', library: 'ライブラリの画像' };
export interface Topic { id: string; storeId: string | null; shared: boolean; channel: Channel | 'both'; title: string; body: string; standalone: boolean; imageUrl: string | null; months: string; active: boolean; useCount: number; lastUsedAt: string | null; sortOrder: number; unknownPlaceholders: string[] }
export interface VarDef { key: string; label: string; default: string }
export interface AccountRow { channel: Channel; externalId: string; username: string; locationName: string; connected: boolean; tokenExpiresAt: string | null; tokenRefreshedAt: string | null; lastError: string | null; updatedAt: string }
export interface StoreSetting {
  igEnabled: boolean; igSchedule: Schedule | null; gbpEnabled: boolean; gbpSchedule: Schedule | null; effectiveIgSchedule: Schedule; effectiveGbpSchedule: Schedule;
  area: string; address: string; hoursText: string; hashtags: string; keywordsFixed: string; keywordsRotation: string; memo: string; vars: Record<string, string>;
  gbpPostUrl: string; igProfileUrl: string;
}
export interface ManualPost extends Post { openUrl: string; openUrlIsSearch: boolean; ready: boolean; issues: string[]; bucket: 'overdue' | 'today' | 'upcoming' }

/** 投稿前の確認（禁止語・差し込み語の未入力・Google の掲載情報・画像）。問題が無ければ空 */
export function checkIssues(p: Post, igNeedsImage = false): string[] {
  const out: string[] = [];
  if (p.compliance.blocking) out.push(`禁止語：${p.compliance.hits.join('、')}`);
  else if (p.compliance.hits.length) out.push(`要確認：${p.compliance.hits.join('、')}`);
  if (p.unfilled.length) out.push(`未入力：${p.unfilled.join(' ')}`);
  if (p.channel === 'gbp' && p.gbpInfo.length) out.push(`GBP掲載情報：${p.gbpInfo.join('、')}`);
  if (p.channel === 'ig' && !p.imageUrl && igNeedsImage) out.push('画像なし');
  return out;
}

/** 画像を保存（同じサイトの画像なので download 属性が効く） */
export function downloadImage(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt('コピーしてください', text); return false; }
}
export interface Patterns { ig: { openings: string[]; closings: string[] }; gbp: { openings: string[]; keywordLines: string[]; closings: string[] } }

/** JSON を送る共通処理。失敗したら error の文を投げる */
export async function sendJson<T = { ok: true }>(url: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

/** "2026-10-08 18:00" → "10/8(木) 18:00" */
export function formatScheduled(dt: string): string {
  const [d, t] = dt.replace('T', ' ').split(' ');
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}(${WEEKDAY_JA[weekdayOf(d)]}) ${t?.slice(0, 5) ?? ''}`.trim();
}

/** "2026-10-08 18:00" → input[type=datetime-local] 用 "2026-10-08T18:00" */
export function toInputDateTime(dt: string): string {
  return dt.replace(' ', 'T').slice(0, 16);
}

export function describeSchedule(s: Schedule): string {
  const t = `${s.hour}:${String(s.minute).padStart(2, '0')}`;
  if (s.type === 'weekly') return `毎週 ${s.weekdays.map((d) => WEEKDAY_JA[d]).join('・')} ${t}`;
  return `毎月 第${s.nth}${WEEKDAY_JA[s.weekday]}曜 ${t}`;
}

/** 禁止語のチェック（サーバーと同じ判定。入力中にその場で出すため） */
export function complianceHits(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  const hits: [string, number][] = [];
  for (const w of words) {
    const k = w.trim();
    if (!k) continue;
    const pos = lower.indexOf(k.toLowerCase());
    if (pos >= 0) hits.push([k, pos]);
  }
  return hits.sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

/** 月のカレンダー（月曜始まり）。各週は 7 日。前後の月の日付は null */
export function monthGrid(ym: string): (string | null)[][] {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (weekdayOf(first) + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; i < last; i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 数字の表示（null は "-"） */
export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? '-' : v.toLocaleString('ja-JP');
}

/** 前の期間との差（％）。前が 0 なら null */
export function pct(now: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/** 画像ファイルを 1080px 以内の JPEG（dataUrl）にする */
export function fileToJpegDataUrl(file: File, max = 1080): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('画像を処理できません'));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}
