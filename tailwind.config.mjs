/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Warm neutrals
        ink: { DEFAULT: '#1d1511', 2: '#4b403a', 3: '#8b7f77', 4: '#b5aaa2' },
        paper: '#f8f5f1',
        surface: '#ffffff',
        sand: { DEFAULT: '#f2ece5', 2: '#e9e0d7' },
        line: { DEFAULT: '#ebe4dd', strong: '#dcd1c7' },
        // Brand
        ember: { 50: '#fff4ef', 100: '#ffe4d8', 500: '#fa4b12', 600: '#e23e08', 700: '#bb3307' },
        cocoa: { DEFAULT: '#2a160c', 2: '#351707', 3: '#4a2a19' },
        // Status
        moss: { DEFAULT: '#1b6f45', bg: '#e8f4ec', line: '#c4e3d0' },
        amber: { DEFAULT: '#9a5806', bg: '#fdf3e0', line: '#f2d9a8' },
        rust: { DEFAULT: '#b02a1c', bg: '#fcebe8', line: '#f3c4bd' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 0 rgba(29,21,17,0.03), 0 1px 2px rgba(29,21,17,0.04)',
        pop: '0 12px 32px -8px rgba(29,21,17,0.18), 0 2px 6px rgba(29,21,17,0.06)',
        sheet: '-24px 0 48px -12px rgba(29,21,17,0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        // Individual translate/scale properties so they compose with Tailwind's centring transforms.
        'pop-in': { from: { opacity: 0, translate: '0 8px', scale: '0.98' }, to: { opacity: 1, translate: '0 0', scale: '1' } },
        'slide-in': { from: { translate: '28px 0', opacity: 0 }, to: { translate: '0 0', opacity: 1 } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'pop-in': 'pop-in 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in': 'slide-in 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
