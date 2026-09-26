// ビルド前に tesseract.js の worker と wasm を ../public/tesseract にコピーする（CDN を使わず自社サーバーだけで動かすため）
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, '..', 'node_modules');
const out = join(here, '..', '..', 'public', 'tesseract');
mkdirSync(out, { recursive: true });

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // 端末の対応状況に応じて 3 種類のうち 1 つだけ読み込まれる（LSTM 専用版）
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
];
for (const [src, dst] of files) {
  const from = join(nm, src);
  if (!existsSync(from)) { console.error(`prepare-ocr: ${from} がありません（npm ci を実行してください）`); process.exit(1); }
  copyFileSync(from, join(out, dst));
}
console.log(`prepare-ocr: ${files.length} files → ${out}`);
