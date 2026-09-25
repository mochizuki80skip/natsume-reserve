import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// ビルド結果は ../public に出力する（index.html と assets/）。PHP の index.php がそれを配信する
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../public', emptyOutDir: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3003', '/install': 'http://127.0.0.1:3003' } },
  test: { include: ['src/**/*.test.ts'] },
});
