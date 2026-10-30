// Instagram ストーリーズ用（1080×1920）の「本日の空き状況」画像を描く（純粋な描画処理。データ取得は呼び出し側）
import { minToHm } from '@/lib/time';

export type SlotStatus = 'open' | 'few' | 'phone' | 'closed';
export interface StorySlot { time: number; period: 'AM' | 'PM'; newStatus: SlotStatus; returnStatus: SlotStatus }
export interface StoryInput {
  storeName: string;
  phone: string;
  dateText: string;   // 例）9月26日（土）
  nowText: string;    // 例）8:30
  slots: StorySlot[]; // 空なら休診・受付なし
  closedText?: string | null; // 休診日などの文言（slots が空のとき）
}

export const STORY_W = 1080;
export const STORY_H = 1920;
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, system-ui, sans-serif';

// テーマ（色と見出しの形）。何店舗もフォローしている方に同じ絵が並ばないよう、店舗ごとに選べる
export type HeaderShape = 'wave' | 'slant' | 'arch' | 'band';
export interface StoryTheme {
  id: string; name: string;
  brand: string;   // 見出し・列の見出しの色
  onBrand: string; // ブランド色の上の文字
  tint: string;    // ごく薄い色（背景・行の縞）
  line: string;
  navy: string;    // 文字・フッターの地
  sub: string;
  open: string;    // 〇
  ret: string;     // △
  phone: string;   // 📞
  none: string;    // ×
  header: HeaderShape;
  dots?: boolean;  // 背景の水玉
  accent?: string; // フッター（紺の地）の線と電話番号の色（無ければブランド色）
}
export const STORY_THEMES: StoryTheme[] = [
  { id: 'sky', name: '水色', brand: '#4cc0ed', onBrand: '#0e3a4f', tint: '#e8f7fd', line: '#bfe7f8', navy: '#0e3a4f', sub: '#47606d', open: '#0f6e92', ret: '#a15c00', phone: '#a15c00', none: '#9aa8b0', header: 'wave' },
  { id: 'sakura', name: 'さくら', brand: '#f4a6c0', onBrand: '#5a1f36', tint: '#fdeef3', line: '#f6cddb', navy: '#5a1f36', sub: '#7a5563', open: '#b0305e', ret: '#8a5a00', phone: '#8a5a00', none: '#b3a2a8', header: 'arch', dots: true },
  { id: 'mint', name: 'ミント', brand: '#6fd3b4', onBrand: '#0f4a3c', tint: '#e8f8f2', line: '#bfeadc', navy: '#0f4a3c', sub: '#46685e', open: '#12795d', ret: '#a15c00', phone: '#a15c00', none: '#9eb3ac', header: 'slant' },
  { id: 'orange', name: 'オレンジ', brand: '#ffb74d', onBrand: '#4a2c00', tint: '#fff4e3', line: '#ffe0b3', navy: '#4a2c00', sub: '#6f5638', open: '#b25e00', ret: '#6c4bb0', phone: '#6c4bb0', none: '#b5a690', header: 'band', dots: true },
  { id: 'lavender', name: 'ラベンダー', brand: '#b9a3f0', onBrand: '#2e1f5e', tint: '#f3effd', line: '#ddd2fa', navy: '#2e1f5e', sub: '#5f5580', open: '#5b3fc4', ret: '#a15c00', phone: '#a15c00', none: '#aaa3bf', header: 'wave', dots: true },
  { id: 'lemon', name: 'レモン', brand: '#ffe066', onBrand: '#3d3500', tint: '#fffbe6', line: '#fff0a8', navy: '#3d3500', sub: '#6b6430', open: '#7a6200', ret: '#b03a2e', phone: '#b03a2e', none: '#b5ae8c', header: 'arch' },
  { id: 'navy', name: 'ネイビー', brand: '#1f3b5b', onBrand: '#ffffff', tint: '#eef2f7', line: '#cdd8e5', navy: '#1f3b5b', sub: '#4f6275', open: '#1f5fa8', ret: '#a15c00', phone: '#a15c00', none: '#9aa6b2', header: 'slant', accent: '#8cc3f0' },
  { id: 'momiji', name: 'もみじ', brand: '#e07a5f', onBrand: '#ffffff', tint: '#fcf0eb', line: '#f3cfc3', navy: '#4a1d10', sub: '#74503f', open: '#b5452a', ret: '#2f6f8f', phone: '#2f6f8f', none: '#b39f97', header: 'band' },
];
/** 店舗ごとの「おまかせ」：店舗コードから決める（店舗ごとに違う色になりやすい） */
export function autoThemeId(storeCode: string): string {
  let h = 0;
  for (const ch of storeCode) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STORY_THEMES[h % STORY_THEMES.length].id;
}
export const themeOf = (id: string | null | undefined, storeCode: string) => STORY_THEMES.find((t) => t.id === (id || autoThemeId(storeCode))) ?? STORY_THEMES[0];
let C: StoryTheme = STORY_THEMES[0];

/** 記号：〇 どなたでも／△ ご通院中の方のみ（30分枠は不可）／📞 お電話で／× 空きなし */
export function symbolFor(s: StorySlot): { mark: string; color: string } {
  if (s.newStatus === 'open' || s.newStatus === 'few') return { mark: '〇', color: C.open };
  if (s.returnStatus === 'open' || s.returnStatus === 'few') return { mark: '△', color: C.ret };
  if (s.newStatus === 'phone' || s.returnStatus === 'phone') return { mark: '📞', color: C.phone };
  return { mark: '×', color: C.none };
}

// Instagram の画面では上端（名前など）と下端（返信欄）が重なるため、内容は上寄せにし、下 150px ほどは空けておく
export function drawStory(canvas: HTMLCanvasElement, input: StoryInput, theme: StoryTheme = STORY_THEMES[0]): void {
  C = theme;
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 背景（白→ごく薄いブランド色）
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, C.tint);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // 背景の水玉（テーマによって）
  if (C.dots) {
    ctx.fillStyle = C.line;
    for (let y = 560; y < STORY_H; y += 120) for (let x = (y / 120) % 2 ? 60 : 0; x < STORY_W; x += 120) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); }
  }
  // 見出し（ブランド色。形はテーマによって：波・斜め・アーチ・帯）
  ctx.fillStyle = C.brand;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(STORY_W, 0);
  if (C.header === 'slant') { ctx.lineTo(STORY_W, 400); ctx.lineTo(0, 470); }
  else if (C.header === 'arch') { ctx.lineTo(STORY_W, 400); ctx.quadraticCurveTo(STORY_W / 2, 540, 0, 400); }
  else if (C.header === 'band') { ctx.lineTo(STORY_W, 450); ctx.lineTo(0, 450); }
  else { ctx.lineTo(STORY_W, 430); ctx.quadraticCurveTo(STORY_W / 2, 500, 0, 430); }
  ctx.closePath();
  ctx.fill();
  if (C.header === 'band') { ctx.fillStyle = C.navy; ctx.fillRect(0, 450, STORY_W, 12); }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.onBrand;
  ctx.font = `bold 50px ${FONT}`;
  ctx.fillText(fit(ctx, input.storeName, 960), STORY_W / 2, 155);
  ctx.font = `bold 96px ${FONT}`;
  ctx.fillText(input.dateText, STORY_W / 2, 258);
  // 「本日の空き状況」は白いラベルで目立たせる（ラベルの中の文字は紺）
  ctx.font = `bold 56px ${FONT}`;
  const title = '本日の空き状況';
  const tw = ctx.measureText(title).width + 90;
  roundRect(ctx, (STORY_W - tw) / 2, 322, tw, 86, 43, '#ffffff', null);
  ctx.fillStyle = C.navy;
  ctx.fillText(title, STORY_W / 2, 366);
  ctx.font = `34px ${FONT}`;
  ctx.fillStyle = C.sub;
  ctx.fillText(`${input.nowText} 時点`, STORY_W / 2, 500);

  const top = 545;
  const bottom = 1480;
  if (input.slots.length === 0) {
    roundRect(ctx, 90, top, STORY_W - 180, 380, 32, '#ffffff', C.line);
    ctx.fillStyle = C.navy;
    ctx.font = `bold 64px ${FONT}`;
    ctx.fillText(input.closedText ?? '本日は休診日です', STORY_W / 2, top + 190);
  } else {
    const am = input.slots.filter((s) => s.period === 'AM');
    const pm = input.slots.filter((s) => s.period === 'PM');
    const colW = 450;
    const gap = 36;
    const x0 = (STORY_W - (colW * 2 + gap)) / 2;
    const head = 92;
    const rows = Math.max(am.length, pm.length, 1);
    const rowH = Math.min(66, Math.floor((bottom - top - head - 24) / rows));
    const cols: [string, StorySlot[], number][] = [['午前', am, x0], ['午後', pm, x0 + colW + gap]];
    for (const [label, list, x] of cols) {
      const h = head + rowH * Math.max(list.length, 1) + 24;
      roundRect(ctx, x, top, colW, h, 32, '#ffffff', C.line);
      // 列の見出し（ブランド色）
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + 32, top); ctx.arcTo(x + colW, top, x + colW, top + head, 32); ctx.lineTo(x + colW, top + head);
      ctx.lineTo(x, top + head); ctx.arcTo(x, top, x + colW, top, 32); ctx.closePath();
      ctx.fillStyle = C.brand;
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = C.onBrand;
      ctx.font = `bold 48px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + colW / 2, top + head / 2 + 2);
      if (list.length === 0) {
        ctx.fillStyle = C.sub;
        ctx.font = `36px ${FONT}`;
        ctx.fillText('受付なし', x + colW / 2, top + head + rowH / 2 + 12);
      }
      list.forEach((s, i) => {
        const ry = top + head + 12 + rowH * i;
        if (i % 2 === 1) { ctx.fillStyle = C.tint; ctx.fillRect(x + 3, ry, colW - 6, rowH); }
        const y = ry + rowH / 2;
        ctx.textAlign = 'right';
        ctx.fillStyle = C.navy;
        ctx.font = `bold ${Math.round(rowH * 0.56)}px ${FONT}`;
        ctx.fillText(minToHm(s.time), x + 215, y);
        const sym = symbolFor(s);
        ctx.textAlign = 'center';
        ctx.fillStyle = sym.color;
        ctx.font = `bold ${Math.round(rowH * 0.7)}px ${FONT}`;
        ctx.fillText(sym.mark, x + 320, y);
      });
    }
  }

  // 凡例（白い帯の中に 1 行）
  roundRect(ctx, 90, 1500, STORY_W - 180, 76, 38, '#ffffff', C.line);
  const legend: [string, string, string][] = [['〇', C.open, 'どなたでも'], ['△', C.ret, 'ご通院中の方'], ['📞', C.phone, 'お電話で'], ['×', C.none, '空きなし']];
  ctx.textAlign = 'left';
  const items = legend.map(([mark, color, text]) => {
    ctx.font = `bold 36px ${FONT}`;
    const mw = ctx.measureText(mark).width + 10;
    ctx.font = `30px ${FONT}`;
    return { mark, color, text, mw, w: mw + ctx.measureText(text).width };
  });
  const totalW = items.reduce((a, b) => a + b.w, 0) + 30 * (items.length - 1);
  let lx = (STORY_W - totalW) / 2;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillText(it.mark, lx, 1539);
    ctx.fillStyle = C.navy;
    ctx.font = `30px ${FONT}`;
    ctx.fillText(it.text, lx + it.mw, 1539);
    lx += it.w + 30;
  }

  // フッター（WEB予約・電話）
  roundRect(ctx, 90, 1600, STORY_W - 180, 150, 32, C.navy, null);
  ctx.fillStyle = C.accent ?? C.brand;
  ctx.fillRect(90 + 32, 1600, STORY_W - 180 - 64, 8);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText('WEB予約はリンクからどうぞ', STORY_W / 2, 1650);
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillStyle = C.accent ?? C.brand;
  ctx.fillText(`📞 ${input.phone}`, STORY_W / 2, 1710);
  ctx.fillStyle = C.sub;
  ctx.font = `24px ${FONT}`;
  ctx.fillText('空き状況は投稿時点のものです。最新はWEB予約ページでご確認ください', STORY_W / 2, 1782);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string | null) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
}

/** 幅に収まるように末尾を省略 */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
