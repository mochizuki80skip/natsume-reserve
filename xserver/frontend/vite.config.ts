import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// ビルド結果は ../public に出力する（index.html と assets/）。PHP の index.php がそれを配信する
// 画面の版（ビルドした日時・日本時間）。サーバーに新しい画面ファイルが入ったかを画面の下で確かめるため
const builtAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(builtAt) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../public', emptyOutDir: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3003', '/install': 'http://127.0.0.1:3003' } },
  test: { include: ['src/**/*.test.ts'] },
});
