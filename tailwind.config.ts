import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pearl Perfect: MAIN — app background, cards, surfaces
        pearl: '#FBF9E4',
        // Midnight: ACCENTS — primary buttons, nav, key icons, route polylines
        midnight: '#122C4F',
        // Noir: HIGHLIGHTS — typography, borders, alerts, critical Job Card data
        noir: '#000000',
        // Emergency only (SOS). A deep red that keeps 4.5:1 contrast on light surfaces and under white text.
        sos: '#B42318',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Slightly larger scale so the app stays readable at arm's length in a truck cab
        base: ['1.0625rem', '1.6'],
      },
      minHeight: {
        touch: '48px',
      },
      minWidth: {
        touch: '48px',
      },
      boxShadow: {
        // Soft, Midnight-tinted depth for frosted surfaces (plus a faint top highlight).
        card: 'inset 0 1px 0 0 rgba(255,255,255,0.65), 0 18px 40px -18px rgba(18,44,79,0.28)',
        'card-accent': '0 10px 24px -12px rgba(18,44,79,0.45)',
      },
      borderRadius: {
        card: '24px',
      },
    },
  },
  plugins: [],
};

export default config;
