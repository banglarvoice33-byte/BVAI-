import type { Config } from 'tailwindcss';

/**
 * Banglar Voice — Premium Editorial palette v2
 * Brand crimson kept for breaking moments.
 * Paper cream, OLED navy, refined shadows & radii.
 */
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#C41E1E', foreground: '#FFFFFF' },
        brand: { DEFAULT: '#CC0000', dark: '#A30000' },
        crimson: { DEFAULT: '#DC2626', light: '#F87171', dark: '#991B1B' },
        ink: '#0F0F0F',
        navy: '#0F172A',
        paper: '#FAFAFD',
        cream: '#FAFAFD',
        muted: '#F5F2ED',
        border: '#E5E2DE',
        surface: {
          DEFAULT: '#FFFFFF',
          elevated: '#FFFFFF',
        },
      },
      fontFamily: {
        serifbn: ['var(--font-serif-bn)', 'Noto Serif Bengali', 'serif'],
        sansbn: ['var(--font-sans-bn)', 'Hind Siliguri', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display': ['2.75rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'headline': ['1.875rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(15, 23, 42, 0.08)',
        card: '0 1px 3px rgba(15, 23, 42, 0.05), 0 6px 20px -8px rgba(15, 23, 42, 0.1)',
        'card-hover': '0 12px 40px -12px rgba(15, 23, 42, 0.16), 0 4px 12px -4px rgba(15, 23, 42, 0.06)',
        elevated: '0 20px 50px -16px rgba(15, 23, 42, 0.18)',
        'inner-glow': 'inset 0 1px 0 0 rgba(255,255,255,0.6)',
      },
      animation: {
        marquee: 'marquee 32s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fade-up 0.5s ease-out both',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [],
};

export default config;
