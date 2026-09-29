// Instagram ストーリーズ用（1080×1920）の「本日の空き状況」画像を描く（純粋な描画処理。データ取得は呼び出し側）
import { minToHm } from '@/lib/time';

export type SlotStatus = 'open' | 'phone' | 'closed';
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

/** 記号：〇 どなたでも／△ ご通院中の方のみ（30分枠は不可）／📞 お電話で／× 空きなし */
export function symbolFor(s: StorySlot): { mark: string; color: string } {
  if (s.newStatus === 'open') return { mark: '〇', color: '#1f6f8b' };
  if (s.returnStatus === 'open') return { mark: '△', color: '#b7791f' };
  if (s.newStatus === 'phone' || s.returnStatus === 'phone') return { mark: '📞', color: '#9a6400' };
  return { mark: '×', color: '#a3aeb5' };
}

export function drawStory(canvas: HTMLCanvasElement, input: StoryInput): void {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, '#e6f2f6');
  bg.addColorStop(1, '#ffffff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // 見出し
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#155366';
  ctx.font = `bold 60px ${FONT}`;
  ctx.fillText(fit(ctx, input.storeName, 980), STORY_W / 2, 250);
  ctx.font = `bold 84px ${FONT}`;
  ctx.fillText(`${input.dateText}`, STORY_W / 2, 360);
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillText('本日の空き状況', STORY_W / 2, 460);
  ctx.font = `40px ${FONT}`;
  ctx.fillStyle = '#4b5a63';
  ctx.fillText(`${input.nowText} 時点`, STORY_W / 2, 530);

  const top = 620;
  const bottom = 1620;
  if (input.slots.length === 0) {
    roundRect(ctx, 90, top, STORY_W - 180, 420, 28, '#ffffff', '#dbe3e7');
    ctx.fillStyle = '#4b5a63';
    ctx.font = `bold 64px ${FONT}`;
    ctx.fillText(input.closedText ?? '本日は休診日です', STORY_W / 2, top + 210);
  } else {
    const am = input.slots.filter((s) => s.period === 'AM');
    const pm = input.slots.filter((s) => s.period === 'PM');
    const colW = 440;
    const gap = 40;
    const x0 = (STORY_W - (colW * 2 + gap)) / 2;
    const rows = Math.max(am.length, pm.length, 1);
    const rowH = Math.min(64, Math.floor((bottom - top - 90) / rows));
    const cols: [string, StorySlot[], number][] = [['午前', am, x0], ['午後', pm, x0 + colW + gap]];
    for (const [label, list, x] of cols) {
      const h = 90 + rowH * Math.max(list.length, 1) + 30;
      roundRect(ctx, x, top, colW, h, 28, '#ffffff', '#dbe3e7');
      ctx.fillStyle = '#155366';
      ctx.font = `bold 44px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + colW / 2, top + 50);
      ctx.strokeStyle = '#dbe3e7';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 30, top + 84); ctx.lineTo(x + colW - 30, top + 84); ctx.stroke();
      if (list.length === 0) {
        ctx.fillStyle = '#8a969d';
        ctx.font = `36px ${FONT}`;
        ctx.fillText('受付なし', x + colW / 2, top + 90 + rowH / 2);
      }
      list.forEach((s, i) => {
        const y = top + 90 + rowH * i + rowH / 2;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#4b5a63';
        ctx.font = `${Math.round(rowH * 0.6)}px ${FONT}`;
        ctx.fillText(minToHm(s.time), x + 200, y);
        const sym = symbolFor(s);
        ctx.textAlign = 'left';
        ctx.fillStyle = sym.color;
        ctx.font = `bold ${Math.round(rowH * 0.72)}px ${FONT}`;
        ctx.fillText(sym.mark, x + 250, y);
      });
    }
  }

  // 凡例
  ctx.textAlign = 'left';
  ctx.font = `34px ${FONT}`;
  const legend: [string, string, string][] = [['〇', '#1f6f8b', 'どなたでも'], ['△', '#b7791f', 'ご通院中の方'], ['📞', '#9a6400', 'お電話で'], ['×', '#a3aeb5', '空きなし']];
  let lx = 100;
  for (const [mark, color, text] of legend) {
    ctx.fillStyle = color;
    ctx.font = `bold 38px ${FONT}`;
    ctx.fillText(mark, lx, 1670);
    ctx.fillStyle = '#4b5a63';
    ctx.font = `32px ${FONT}`;
    ctx.fillText(text, lx + 50, 1670);
    lx += 50 + ctx.measureText(text).width + 40;
  }

  // フッター
  roundRect(ctx, 90, 1720, STORY_W - 180, 150, 28, '#1f6f8b', null);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText('WEB予約はプロフィールのリンクから', STORY_W / 2, 1770);
  ctx.font = `38px ${FONT}`;
  ctx.fillText(`お電話 ${input.phone}`, STORY_W / 2, 1830);
  ctx.fillStyle = '#6b7a82';
  ctx.font = `26px ${FONT}`;
  ctx.fillText('空き状況は投稿時点のものです。最新はWEB予約ページでご確認ください', STORY_W / 2, 1900);
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
