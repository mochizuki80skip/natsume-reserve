import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { CHANGELOG, LATEST_CHANGE_ID } from './src/changelog';

// ビルド結果は ../public に出力する（index.html と assets/）。PHP の index.php がそれを配信する
// 画面の版（ビルドした日時・日本時間）。サーバーに新しい画面ファイルが入ったかを画面の下で確かめるため
const builtAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

// 開いたままの古い画面が「新しい版が出た」ことと変更内容を知るためのファイル（public/version.json）
const versionFile = {
  name: 'version-json',
  closeBundle() {
    const out = fileURLToPath(new URL('../public/version.json', import.meta.url));
    writeFileSync(out, JSON.stringify({ version: builtAt, latestId: LATEST_CHANGE_ID, notes: CHANGELOG.slice(0, 10) }, null, 1));
  },
};

export default defineConfig({
  plugins: [react(), versionFile],
  define: { __APP_VERSION__: JSON.stringify(builtAt) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../public', emptyOutDir: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3003', '/install': 'http://127.0.0.1:3003' } },
  test: { include: ['src/**/*.test.ts'] },
});
