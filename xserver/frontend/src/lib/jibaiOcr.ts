// 自賠責請求書のスクショをブラウザの中だけで読み取る（tesseract.js）。画像は社外に送らない。
// 1 段階目：日本語モデルで画面全体を読み、位置から各項目を探す
// 2 段階目：合計金額（と実日数）の欄だけを英数字モデル＋数字限定で読み直して精度を上げる
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { normalizePatientNo, parseAmountText, parseDaysText, parseInvoice, type OcrLine, type ParsedInvoice, type Rect } from './jibaiParse';

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
const TARGET_WIDTH = 1600;

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

/** 文字が小さいスクショは拡大し、端の文字が切れないよう白い余白を付ける */
function prepareCanvas(img: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(3, Math.max(1, TARGET_WIDTH / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale) + PAD * 2;
  canvas.height = Math.round(img.naturalHeight * scale) + PAD * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, PAD, PAD, Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  return { canvas, scale };
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

async function readDigits(worker: Worker, canvas: HTMLCanvasElement, rect: Rect, whitelist = '0123456789,'): Promise<{ text: string; confidence: number }> {
  await worker.setParameters({ tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: PSM.SINGLE_LINE });
  const c = clampRect(rect, canvas.width, canvas.height);
  const { data } = await worker.recognize(canvas, { rectangle: { left: c.x0, top: c.y0, width: c.x1 - c.x0, height: c.y1 - c.y0 } }, { text: true });
  return { text: data.text ?? '', confidence: data.confidence ?? 0 };
}

export async function readInvoiceImage(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<InvoiceReadResult> {
  const t0 = performance.now();
  onProgressGlobal = onProgress ?? null;
  const [jpn, eng] = await Promise.all([getWorker('jpn'), getWorker('eng')]);
  onProgressGlobal = null;
  const img = await loadImageFile(file);
  const { canvas } = prepareCanvas(img);

  onProgress?.({ stage: 'read1', message: '画面全体を読み取り中…' });
  const pass1 = await jpn.recognize(canvas, {}, { blocks: true, text: true });
  const lines = toLines(pass1.data.blocks);
  if (isDebug()) console.log('[jibai-ocr] pass1', JSON.stringify({ size: [canvas.width, canvas.height], blocks: pass1.data.blocks?.length ?? null, lines: lines.map((l) => `y=${l.y0}: ${l.words.map((w) => `${w.text}@${w.x0}`).join(' | ')}`) }));
  const parsed: ParsedInvoice = parseInvoice(lines, canvas.width, canvas.height);

  onProgress?.({ stage: 'read2', message: '合計金額を読み直し中…' });
  const warnings: string[] = [];
  let amount = parsed.amount;
  if (parsed.amountRect) {
    const r = await readDigits(eng, canvas, parsed.amountRect);
    const a2 = parseAmountText(r.text);
    if (isDebug()) console.log('[jibai-ocr] pass2', JSON.stringify({ rect: parsed.amountRect, text: r.text, confidence: r.confidence, parsed }));
    if (a2 !== null && a2 > 0) {
      if (amount !== null && amount !== a2) warnings.push(`合計の読み取りが 2 通り（${amount.toLocaleString('ja-JP')} / ${a2.toLocaleString('ja-JP')}）。画像を見て確認してください`);
      else if (amount === null) warnings.push('合計は数字欄の読み直しだけで読めました。画像を見て確認してください');
      amount = a2;
      if (r.confidence > 0 && r.confidence < 30) warnings.push('合計の読み取り精度が低めです');
    } else if (amount === null) {
      warnings.push('合計が読み取れませんでした。手で入力してください');
    } else {
      warnings.push('合計の読み直しができませんでした。画像を見て確認してください');
    }
  }
  // 患者番号は英数字限定で読み直す（罫線が「s」などに化けるのを防ぐ）
  let patientNo = parsed.patientNo;
  if (parsed.patientNoRect) {
    const r = await readDigits(eng, canvas, parsed.patientNoRect, '0123456789abcdefghijklmnopqrstuvwxyz');
    const n2 = normalizePatientNo(r.text.trim());
    if (isDebug()) console.log('[jibai-ocr] patientNo', JSON.stringify({ text: r.text, confidence: r.confidence, n2 }));
    if (n2) {
      if (patientNo && n2.replace(/\D/g, '') !== patientNo.replace(/\D/g, '')) warnings.push(`患者番号の読み取りが 2 通り（${patientNo} / ${n2}）。画像を見て確認してください`);
      patientNo = n2;
    }
  }
  let days = parsed.days;
  if (days === null && parsed.daysRect) {
    const r = await readDigits(eng, canvas, parsed.daysRect, '0123456789');
    days = parseDaysText(r.text);
  }
  if (!patientNo) warnings.push('患者番号が読み取れませんでした');
  if (!parsed.ym) warnings.push('対象月（令和 年 月）が読み取れませんでした');

  const headerImage = parsed.headerRect ? cropDataUrl(canvas, parsed.headerRect, 360) : null;
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
