/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0B0E11',
          secondary: '#12161A',
          panel: '#161B22',
          card: '#0D1117',
          hover: '#1A2030',
        },
        border: {
          default: '#2B2F36',
          subtle: '#1E2329',
          accent: '#474D57',
        },
        brand: {
          cyan: '#00E6FF',
          gold: '#FFB800',
          green: '#02C076',
          red: '#FF433D',
          purple: '#A855F7',
          blue: '#2563EB',
        },
        text: {
          primary: '#EAECEF',
          secondary: '#848E9C',
          muted: '#5E6673',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        pulse_slow: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        spin_slow: 'spin 8s linear infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
        ticker: 'ticker 30s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00E6FF33' },
          '100%': { boxShadow: '0 0 20px #00E6FF66, 0 0 40px #00E6FF22' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};
