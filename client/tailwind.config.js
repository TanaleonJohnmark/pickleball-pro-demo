/** Design tokens — Pickleball Pro.
 *  navy: club identity + sidebar   court: pickleball-court green (primary action)
 *  line: court-line white          cyan: live / interactive accents     gold: premium & champions */
import fs from 'node:fs';
const brand = JSON.parse(fs.readFileSync(new URL('./brand.json', import.meta.url), 'utf8'));
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: brand.colors,
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        sans: ['Barlow', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
