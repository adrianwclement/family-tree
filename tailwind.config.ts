import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bark: '#202622',
        moss: '#2d7a73',
        leaf: '#dcefed',
        parchment: '#f7f5f1',
      },
      boxShadow: {
        card: '0 14px 36px rgba(34, 43, 39, 0.1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
