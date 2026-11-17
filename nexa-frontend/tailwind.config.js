/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        nexa: {
          50: '#f0f5ff',
          100: '#e0ebfe',
          200: '#bad4fe',
          300: '#7cb2fd',
          400: '#388bfd',
          500: '#1f6feb',
          600: '#1158c7',
          700: '#0d429a',
          800: '#0e387c',
          900: '#113166',
          950: '#0a1d3f',
          dark: '#070a12',
          card: '#0c111d',
          surface: '#101726',
          panel: '#131b2e',
          border: '#1b253b',
          cyan: '#38bdf8',
          accent: '#2563eb',
        },
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 12s linear infinite',
        'ripple': 'ripple 3s ease-out infinite',
        'wave': 'wave 1.2s ease-in-out infinite',
      },
      keyframes: {
        ripple: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        wave: {
          '0%, 100%': { height: '8px' },
          '50%': { height: '32px' },
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 25px -5px rgba(56, 189, 248, 0.25)',
        'glow-blue': '0 0 35px -5px rgba(37, 99, 235, 0.3)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
    },
  },
  plugins: [],
}
