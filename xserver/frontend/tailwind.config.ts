import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { DEFAULT: '#1f6f8b', dark: '#155366', light: '#e6f2f6' } } } },
  plugins: [],
};
export default config;
