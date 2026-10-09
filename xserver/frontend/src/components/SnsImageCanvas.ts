// 投稿用の定型画像（1080×1080）を描く。ブラウザで描いて JPEG にして保存するため、サーバー側の画像処理や生成 AI は使わない
export const POST_W = 1080;
export const POST_H = 1080;
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, system-ui, sans-serif';
const C = { brand: '#4cc0ed', tint: '#e8f7fd', navy: '#0e3a4f', sub: '#47606d', white: '#ffffff' };

export interface PostImageInput { storeName: string; title: string; body: string; phone: string; footer?: string; variant?: number }

export function drawPostImage(canvas: HTMLCanvasElement, input: PostImageInput): void {
  canvas.width = POST_W; canvas.height = POST_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const v = (input.variant ?? 0) % 3;
  // 背景
  ctx.fillStyle = v === 1 ? C.navy : C.white;
  ctx.fillRect(0, 0, POST_W, POST_H);
  if (v === 0) {
    const g = ctx.createLinearGradient(0, 0, 0, POST_H); g.addColorStop(0, C.white); g.addColorStop(1, C.tint);
    ctx.fillStyle = g; ctx.fillRect(0, 0, POST_W, POST_H);
  }
  // 帯
  ctx.fillStyle = C.brand;
  if (v === 2) ctx.fillRect(0, 0, POST_W, POST_H); else ctx.fillRect(0, 0, POST_W, 150);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = v === 1 ? C.white : C.navy;
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(fit(ctx, input.storeName, 900), 70, 75);
  // 見出し
  const titleColor = v === 1 ? C.white : C.navy;
  ctx.fillStyle = titleColor;
  const title = input.title.trim() || input.body.trim().slice(0, 20);
  let y = 300;
  for (const line of wrap(ctx, title, 940, `bold 76px ${FONT}`).slice(0, 3)) { ctx.font = `bold 76px ${FONT}`; ctx.fillText(line, 70, y); y += 96; }
  // 区切り線
  ctx.fillStyle = v === 2 ? C.white : C.brand;
  ctx.fillRect(70, y - 20, 160, 8);
  y += 60;
  // 本文（抜粋）
  ctx.fillStyle = v === 1 ? '#d7eef8' : C.sub;
  const bodyLines = wrap(ctx, input.body.trim(), 940, `38px ${FONT}`);
  const maxLines = Math.max(0, Math.floor((900 - y) / 58));
  bodyLines.slice(0, maxLines).forEach((line, i) => { ctx.font = `38px ${FONT}`; ctx.fillText(i === maxLines - 1 && bodyLines.length > maxLines ? line.slice(0, -1) + '…' : line, 70, y + i * 58); });
  // フッター
  ctx.fillStyle = v === 1 ? C.brand : C.navy;
  ctx.fillRect(0, 960, POST_W, 120);
  ctx.fillStyle = C.white;
  ctx.font = `bold 36px ${FONT}`;
  ctx.fillText(fit(ctx, input.footer ?? 'ご予約はプロフィールのリンクから', 640), 70, 1020);
  ctx.textAlign = 'right';
  ctx.font = `bold 34px ${FONT}`;
  if (input.phone) ctx.fillText(`📞 ${input.phone}`, POST_W - 70, 1020);
}

/** 日本語の折り返し：幅に収まるように 1 文字ずつ詰める。行頭に句読点を置かない */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string): string[] {
  ctx.font = font;
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const ch of Array.from(para)) {
      if (ctx.measureText(line + ch).width > maxW && line !== '') {
        if ('、。，．」』）!?！？'.includes(ch)) { line += ch; continue; }
        out.push(line); line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
