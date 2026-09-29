// 自賠責請求書のスクショをブラウザの中だけで読み取る（tesseract.js）。画像は社外に送らない。
// 1 段階目：日本語モデルで画面全体を読み、文字の大きさと請求書の範囲を測る。
//          文字が小さすぎる／大きすぎる、または画面全体を撮っていて請求書が一部だけのときは、
//          請求書の部分だけを切り出し、読みやすい大きさにそろえてもう一度読む
// 2 段階目：合計金額・実日数・患者番号の欄だけを切り出し、白黒にして罫線を消してから
//          数字限定で何通りかの方法で読み直し、多数決で決める
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { chooseAmount, chooseDays, findAmount, findInvoiceRect, findSubtotalColumn, medianLineHeight, normalizePatientNo, parseAmountText, parseInvoice, type AmountCandidate, type OcrLine, type Rect } from './jibaiParse';

export interface OcrProgress { stage: 'load' | 'read1' | 'read2' | 'done'; message: string }

export interface InvoiceReadResult {
  patientNo: string;
  patientName: string;
  ym: string | null;
  days: number | null;
  amount: number | null;
  /** 1 段階目と 2 段階目の合計が食い違ったなど、目視確認を促す理由 */
  warnings: string[];
  /** 確認用の切り抜き（data URL） */
  headerImage: string | null;
  amountImage: string | null;
  /** 読み取りにかかった時間（ms） */
  elapsedMs: number;
}

const PAD = 40;

/** localStorage に jibaiDebug=1 を入れると読み取り結果の詳細をコンソールに出す（精度の調査用） */
function isDebug(): boolean {
  try { return localStorage.getItem('jibaiDebug') === '1'; } catch { return false; }
}

function assetBase(): string {
  return `${window.location.origin}`;
}

let jpnWorker: Promise<Worker> | null = null;
let engWorker: Promise<Worker> | null = null;
let onProgressGlobal: ((p: OcrProgress) => void) | null = null;

async function makeWorker(lang: 'jpn' | 'eng'): Promise<Worker> {
  const base = assetBase();
  const worker = await createWorker(lang, 1, {
    workerPath: `${base}/tesseract/worker.min.js`,
    corePath: `${base}/tesseract/`,
    langPath: `${base}/tessdata`,
    gzip: true,
    logger: (m) => {
      if (onProgressGlobal && typeof m.progress === 'number' && /loading|initializing/.test(m.status)) {
        onProgressGlobal({ stage: 'load', message: `読み取りエンジンを準備中（${lang === 'jpn' ? '日本語' : '数字'}）… ${Math.round(m.progress * 100)}%` });
      }
    },
  });
  if (lang === 'jpn') {
    await worker.setParameters({ preserve_interword_spaces: '1' });
  }
  return worker;
}

function getWorker(lang: 'jpn' | 'eng'): Promise<Worker> {
  if (lang === 'jpn') return (jpnWorker ??= makeWorker('jpn').catch((e) => { jpnWorker = null; throw e; }));
  return (engWorker ??= makeWorker('eng').catch((e) => { engWorker = null; throw e; }));
}

/** 初回のダウンロード（数 MB）を先に済ませておく */
export async function warmUpOcr(onProgress?: (p: OcrProgress) => void): Promise<void> {
  onProgressGlobal = onProgress ?? null;
  await Promise.all([getWorker('jpn'), getWorker('eng')]);
  onProgressGlobal = null;
}

export async function loadImageFile(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 本文の行の高さの目標（px）。tesseract はこのくらいの大きさで最もよく読める */
const TARGET_LH = 30;
const MAX_CANVAS_W = 4200;
const MAX_CANVAS_AREA = 18_000_000;

interface Rendered { canvas: HTMLCanvasElement; scale: number; src: Rect }

/** 画像の src の範囲を scale 倍にして、端の文字が切れないよう白い余白を付けたキャンバスに描く */
function render(img: HTMLImageElement, src: Rect, scale: number): Rendered {
  const sw = src.x1 - src.x0, sh = src.y1 - src.y0;
  let k = scale;
  k = Math.min(k, (MAX_CANVAS_W - PAD * 2) / sw, Math.sqrt(MAX_CANVAS_AREA / (sw * sh)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * k) + PAD * 2;
  canvas.height = Math.round(sh * k) + PAD * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, src.x0, src.y0, sw, sh, PAD, PAD, Math.round(sw * k), Math.round(sh * k));
  return { canvas, scale: k, src };
}

/**
 * 表の罫線（長い横線・縦線）を白で塗りつぶす。罫線があると tesseract が表の右側の列（小計・合計）を
 * まるごと読み落とすことがあるため、全体を読む前に消しておく。minRun 以上連続する黒い画素だけを消す
 */
function removeRuledLines(canvas: HTMLCanvasElement, minRun: number): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114 < 160 ? 1 : 0;
  const kill = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark[y * W + x]) { run++; continue; }
      if (run >= minRun) for (let k = x - run; k < x; k++) kill[y * W + k] = 1;
      run = 0;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && dark[y * W + x]) { run++; continue; }
      if (run >= minRun) for (let k = y - run; k < y; k++) kill[k * W + x] = 1;
      run = 0;
    }
  }
  for (let i = 0; i < W * H; i++) if (kill[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; }
  ctx.putImageData(img, 0, 0);
}

/**
 * 罫線を消した上で全体を読む。読み方（psm）を変えて何通りか試し、
 * 「小計の列がどれだけ読めたか」と「合計の行が見つかったか」で最も良い結果を採る
 */
async function readPage(worker: Worker, r: Rendered, lhHint: number | null): Promise<{ lines: OcrLine[]; kei: number; score: number }> {
  removeRuledLines(r.canvas, Math.max(40, Math.round((lhHint ?? 14 * r.scale) * 2.5)));
  let best: { lines: OcrLine[]; kei: number; score: number } | null = null;
  for (const psm of [PSM.AUTO, PSM.SINGLE_COLUMN, PSM.SPARSE_TEXT]) {
    const lines = await recognizeLines(worker, r.canvas, psm);
    const col = findSubtotalColumn(lines);
    const kei = col ? col.words.length : 0;
    const amt = findAmount(lines, r.canvas.width, r.canvas.height);
    const totalFound = col !== null && amt.labelFound && amt.amount !== null && amt.amount >= amt.maxSubtotal;
    const score = Math.min(kei, 12) + (totalFound ? 10 : 0);
    if (!best || score > best.score) best = { lines, kei, score };
    if (kei >= 6 && totalFound) break; // 小計の列と合計が読めたら終わり
  }
  return best!;
}

/** キャンバス上の範囲 → 元画像上の範囲 */
function toSource(r: Rendered, rect: Rect): Rect {
  return {
    x0: Math.max(r.src.x0, (rect.x0 - PAD) / r.scale + r.src.x0), y0: Math.max(r.src.y0, (rect.y0 - PAD) / r.scale + r.src.y0),
    x1: Math.min(r.src.x1, (rect.x1 - PAD) / r.scale + r.src.x0), y1: Math.min(r.src.y1, (rect.y1 - PAD) / r.scale + r.src.y0),
  };
}

/**
 * 数字を読み直す前の下ごしらえ：文字を大きくしてから（なめらかに拡大）白黒にし（大津の二値化）、
 * 表の罫線（長い縦線・横線）を消す。先に白黒にしてから拡大すると「3」が「8」につぶれることがあるため、この順番にする
 */
function cleanCrop(canvas: HTMLCanvasElement, rect: Rect, lh: number, targetLh = 44): HTMLCanvasElement {
  const c = clampRect(rect, canvas.width, canvas.height);
  const cw = c.x1 - c.x0, ch = c.y1 - c.y0;
  const k = Math.max(1, Math.min(4, targetLh / Math.max(8, lh)));
  const w = Math.round(cw * k), h = Math.round(ch * k);
  const big = document.createElement('canvas');
  big.width = w; big.height = h;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(canvas, c.x0, c.y0, cw, ch, 0, 0, w, h);
  const src = bctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(src.data[i * 4] * 0.299 + src.data[i * 4 + 1] * 0.587 + src.data[i * 4 + 2] * 0.114);
    gray[i] = g; hist[g]++;
  }
  // 大津の方法でしきい値を決める
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = w * h - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = t; }
  }
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = gray[i] <= th ? 1 : 0;
  // 高さの 60% 以上つながる縦線、幅の 60% 以上つながる横線は罫線とみなして消す
  for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) n += dark[y * w + x]; if (n > h * 0.6) for (let y = 0; y < h; y++) dark[y * w + x] = 0; }
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += dark[y * w + x]; if (n > w * 0.6) for (let x = 0; x < w; x++) dark[y * w + x] = 0; }
  const pad = 24;
  const res = document.createElement('canvas');
  res.width = w + pad * 2; res.height = h + pad * 2;
  const ctx = res.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, res.width, res.height);
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = dark[i] ? 0 : 255; out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
  ctx.putImageData(out, pad, pad);
  return res;
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(w, Math.ceil(r.x1)), y1 = Math.min(h, Math.ceil(r.y1));
  return { x0, y0, x1: Math.max(x0 + 1, x1), y1: Math.max(y0 + 1, y1) };
}

function cropDataUrl(canvas: HTMLCanvasElement, r: Rect, maxWidth = 320): string {
  const c = clampRect(r, canvas.width, canvas.height);
  const w = c.x1 - c.x0, h = c.y1 - c.y0;
  const s = Math.min(1, maxWidth / w);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * s));
  out.height = Math.max(1, Math.round(h * s));
  out.getContext('2d')!.drawImage(canvas, c.x0, c.y0, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** tesseract の階層（block → paragraph → line → word）を平らな行の一覧にする */
function toLines(blocks: Tesseract.Block[] | null | undefined): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const b of blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    const words = l.words.filter((w) => w.text.trim() !== '').map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
    if (words.length === 0) continue;
    lines.push({ words, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 });
  }
  return lines;
}

/** 全体の読み取り（日本語）。数字読み直しで変えた設定を毎回元に戻す */
async function recognizeLines(worker: Worker, canvas: HTMLCanvasElement, psm: PSM = PSM.AUTO): Promise<OcrLine[]> {
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: '', preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  return toLines(data.blocks);
}

async function readDigits(worker: Worker, canvas: HTMLCanvasElement, rect: Rect | null, whitelist = '0123456789,', psm: PSM = PSM.SINGLE_LINE): Promise<{ text: string; confidence: number }> {
  await worker.setParameters({ tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: psm });
  const opts = rect ? (() => { const c = clampRect(rect, canvas.width, canvas.height); return { rectangle: { left: c.x0, top: c.y0, width: c.x1 - c.x0, height: c.y1 - c.y0 } }; })() : {};
  const { data } = await worker.recognize(canvas, opts, { text: true });
  return { text: data.text ?? '', confidence: data.confidence ?? 0 };
}

function debugLines(tag: string, canvas: HTMLCanvasElement, lines: OcrLine[], extra: Record<string, unknown> = {}): void {
  if (!isDebug()) return;
  // 調査用の出力にも住所・生年月日は出さない（患者番号の行と「生年」を含む行は省く）
  const patientLine = lines.find((l) => l.words.some((w) => normalizePatientNo(w.text)));
  const shown = lines.filter((l) => l !== patientLine && !l.words.some((w) => /生年|住所/.test(w.text)));
  console.log(`[jibai-ocr] ${tag}`, JSON.stringify({ size: [canvas.width, canvas.height], ...extra, note: '患者番号の行と生年月日の行は出力しません', lines: shown.map((l) => `y=${l.y0}: ${l.words.map((w) => `${w.text}@${w.x0}`).join(' | ')}`) }));
}

export async function readInvoiceImage(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<InvoiceReadResult> {
  const t0 = performance.now();
  onProgressGlobal = onProgress ?? null;
  const [jpn, eng] = await Promise.all([getWorker('jpn'), getWorker('eng')]);
  onProgressGlobal = null;
  const img = await loadImageFile(file);
  const whole: Rect = { x0: 0, y0: 0, x1: img.naturalWidth, y1: img.naturalHeight };

  // 1 段階目：まず全体を読む（小さな画像は横 1600px 程度まで拡大）。小計の列が読めなければ大きくして読み直す
  onProgress?.({ stage: 'read1', message: '画面全体を読み取り中…' });
  let r = render(img, whole, Math.min(3, Math.max(1, 1600 / img.naturalWidth)));
  let page = await readPage(jpn, r, null);
  if (page.kei < 3 && r.scale < 3) {
    const r2 = render(img, whole, Math.min(4, r.scale * 1.6));
    const p2 = await readPage(jpn, r2, null);
    if (p2.score > page.score) { r = r2; page = p2; }
  }
  let lines = page.lines;
  const col1 = findSubtotalColumn(lines);
  let lh = col1 ? col1.lh : medianLineHeight(lines);
  const inv = findInvoiceRect(lines, r.canvas.width, r.canvas.height);
  const srcTextH = lh !== null ? lh / r.scale : null; // 元の画像での文字の高さ（px）
  debugLines('pass1', r.canvas, lines, { lh, srcTextH, kei: page.kei, scale: r.scale, invoice: inv });

  // 文字の大きさが目標から外れている、または請求書が画像の一部だけなら、請求書の部分を切り出して読み直す。
  // 読み直した方が良ければ（小計の列が同じかそれ以上読めていれば）そちらを主にし、合計・実日数は両方の票を合わせる
  const passes: { r: Rendered; lines: OcrLine[]; lh: number }[] = [{ r, lines, lh: lh ?? TARGET_LH }];
  const invSrc = inv ? toSource(r, inv) : whole;
  const areaRatio = ((invSrc.x1 - invSrc.x0) * (invSrc.y1 - invSrc.y0)) / (img.naturalWidth * img.naturalHeight);
  const scaleOff = lh !== null && (lh < TARGET_LH * 0.8 || lh > TARGET_LH * 1.35);
  if (inv && lh !== null && (scaleOff || areaRatio < 0.8 || page.score < 16)) {
    onProgress?.({ stage: 'read1', message: '請求書の部分を読みやすい大きさにして読み直し中…' });
    const srcLh = lh / r.scale; // 元画像での文字の高さ
    const rb = render(img, invSrc, TARGET_LH / srcLh);
    const pb = await readPage(jpn, rb, TARGET_LH);
    const cb = findSubtotalColumn(pb.lines);
    debugLines('pass1b', rb.canvas, pb.lines, { kei: pb.kei, scale: rb.scale, src: invSrc });
    const pass = { r: rb, lines: pb.lines, lh: cb ? cb.lh : medianLineHeight(pb.lines) ?? TARGET_LH };
    if (pb.score >= page.score) passes.unshift(pass); else passes.push(pass);
  }
  r = passes[0].r; lines = passes[0].lines; lh = passes[0].lh;
  const canvas = r.canvas;
  const parsed = parseInvoice(lines, canvas.width, canvas.height);
  const lineH = lh ?? TARGET_LH;
  const warnings: string[] = [];

  // 2 段階目：合計・実日数。読み取りごとに、全体の読み＋切り抜きの読み直し（何通りか）を票にして多数決
  onProgress?.({ stage: 'read2', message: '合計金額・実日数を読み直し中…' });
  const cands: AmountCandidate[] = [];
  let maxSubtotal = 0;
  const subtotals = new Set<number>();
  let totalLabelFound = false;
  const daysAll = { column: [] as number[], outcome: [] as number[], counts: [] as number[], columnRect: null as Rect | null };
  const extraDays: number[] = [];
  for (const [i, pass] of passes.entries()) {
    const pp = i === 0 ? parsed : parseInvoice(pass.lines, pass.r.canvas.width, pass.r.canvas.height);
    const cv = pass.r.canvas;
    maxSubtotal = Math.max(maxSubtotal, pp.maxSubtotal);
    for (const v of pp.subtotals) subtotals.add(v);
    if (pp.totalLabelFound) totalLabelFound = true;
    cands.push({ text: '', value: pp.amount, weight: 1, source: `p${i}-page` });
    if (pp.amountRect) {
      const clean = cleanCrop(cv, pp.amountRect, pass.lh);
      const reads = [
        { src: 'eng-raw', ...(await readDigits(eng, cv, pp.amountRect)) },
        { src: 'eng-clean', ...(await readDigits(eng, clean, null)) },
        { src: 'jpn-clean', ...(await readDigits(jpn, clean, null)) },
        { src: 'eng-clean-word', ...(await readDigits(eng, clean, null, '0123456789,', PSM.SINGLE_WORD)) },
      ];
      for (const x of reads) cands.push({ text: x.text.trim(), value: parseAmountText(x.text), weight: 1, source: `p${i}-${x.src}` });
    }
    daysAll.column.push(...pp.daysCandidates.column);
    daysAll.outcome.push(...pp.daysCandidates.outcome);
    // 施術回数は同じ画像の読み直しで重複しやすいので、主の読み取りの分だけ数える
    if (i === 0) daysAll.counts.push(...pp.daysCandidates.counts);
    if (pp.daysRect) {
      const clean = cleanCrop(cv, pp.daysRect, pass.lh);
      for (const x of [await readDigits(eng, clean, null, '0123456789', PSM.SINGLE_BLOCK), await readDigits(jpn, clean, null, '0123456789', PSM.SINGLE_BLOCK)]) {
        for (const m of x.text.matchAll(/\d{1,2}/g)) { const n = Number(m[0]); if (n >= 1 && n <= 31) extraDays.push(n); }
      }
    }
  }
  const choice = chooseAmount(cands, maxSubtotal);
  if (isDebug()) console.log('[jibai-ocr] amount', JSON.stringify({ rect: parsed.amountRect, maxSubtotal, cands, choice }));
  const amount = choice.amount;
  if (amount === null) warnings.push('合計が読み取れませんでした。手で入力してください');
  else if (amount < maxSubtotal || subtotals.has(amount) || !totalLabelFound) warnings.push('合計の行を特定できませんでした（小計の金額を読んだ可能性があります）。画像を見て確認してください');
  else if (choice.support < 2) warnings.push(`合計の読み取りに自信がありません（${choice.alternatives.length ? `ほかの候補：${choice.alternatives.map((v) => v.toLocaleString('ja-JP')).join('・')}` : '読めたのは 1 通りだけ'}）。画像を見て確認してください`);
  else if (choice.alternatives.length && choice.support * 2 <= choice.total) warnings.push(`合計の読み取りが割れました（ほかの候補：${choice.alternatives.map((v) => v.toLocaleString('ja-JP')).join('・')}）。画像を見て確認してください`);

  // 実日数：列・転帰・施術回数の多数決。列は数字だけでも読み直して票に加える
  const dchoice = chooseDays(daysAll, extraDays);
  if (isDebug()) console.log('[jibai-ocr] days', JSON.stringify({ candidates: daysAll, extraDays, dchoice }));
  const days = dchoice.days;
  if (days === null) warnings.push('実日数が読み取れませんでした。手で入力してください');
  else if (!dchoice.confident) warnings.push('実日数の読み取りに自信がありません。画像を見て確認してください');

  // 患者番号は英数字限定で読み直す（罫線が「s」などに化けるのを防ぐ）
  let patientNo = parsed.patientNo;
  if (parsed.patientNoRect) {
    const al = '0123456789abcdefghijklmnopqrstuvwxyz';
    const clean = cleanCrop(canvas, parsed.patientNoRect, lineH);
    const reads = [await readDigits(eng, canvas, parsed.patientNoRect, al), await readDigits(eng, clean, null, al), await readDigits(jpn, clean, null, al), await readDigits(eng, clean, null, al, PSM.SINGLE_WORD)];
    const nos = reads.map((x) => normalizePatientNo(x.text.trim())).filter((x): x is string => !!x);
    if (isDebug()) console.log('[jibai-ocr] patientNo', JSON.stringify({ reads: reads.map((x) => x.text), nos }));
    const vote = new Map<string, number>();
    for (const n of [...nos, ...(patientNo ? [patientNo] : [])]) vote.set(n, (vote.get(n) ?? 0) + 1);
    const ranked = [...vote.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    if (ranked.length) {
      patientNo = ranked[0][0];
      if (ranked.length > 1 && ranked[0][1] < 2) warnings.push(`患者番号の読み取りが割れました（${ranked.map((x) => x[0]).join(' / ')}）。画像を見て確認してください`);
    }
  }
  if (!patientNo) warnings.push('患者番号が読み取れませんでした');
  // 撮り直しの案内（読み取りを誤りやすい画像）
  if (page.kei < 3 && passes.every((p) => !findSubtotalColumn(p.lines))) warnings.push('請求書の表をうまく読み取れませんでした。画像がぼやけていないか、請求書全体（下の合計まで）が写っているか確認してください');
  else if (srcTextH !== null && srcTextH < 9.5) warnings.push('スクショの文字が小さいため読み取りを誤りやすい状態です。レセコンのプレビューを拡大（100% 以上）してから撮り直すと正確に読めます');
  if (!parsed.ym) warnings.push('請求月（令和 年 月）が読み取れませんでした');

  // 切り抜きは患者番号〜氏名と合計欄だけ。住所・生年月日・傷病名などの領域は画像にも文字にも残さない
  const headerImage = parsed.headerRect ? cropDataUrl(canvas, parsed.headerRect, 300) : null;
  const amountImage = parsed.amountRect ? cropDataUrl(canvas, parsed.amountRect, 200) : null;
  onProgress?.({ stage: 'done', message: '完了' });
  return {
    patientNo: patientNo ?? '',
    patientName: parsed.patientName ?? '',
    ym: parsed.ym,
    days,
    amount,
    warnings,
    headerImage,
    amountImage,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

/** ページを離れるときなどに呼ぶ（メモリ解放） */
export async function disposeOcr(): Promise<void> {
  const ws = [jpnWorker, engWorker];
  jpnWorker = null;
  engWorker = null;
  for (const w of ws) {
    try { (await w)?.terminate(); } catch { /* 無視 */ }
  }
}
