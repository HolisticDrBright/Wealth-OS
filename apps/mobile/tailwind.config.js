/**
 * Simple-mode design tokens (Phase M1) — defined ONCE here, used everywhere.
 * Source: the Simple-mode design canvas. Never hardcode these hexes in screens.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ground: '#0b0d12',
        card: '#161922',
        inset: '#0f1218',
        stroke: '#262b38',

        ink: {
          DEFAULT: '#f4f5f8',   // primary text
          body: '#dfe1e7',
          secondary: '#b9bcc6',
          muted: '#9a9eaa',
        },

        accent: {
          DEFAULT: '#3cc8e6',   // cyan
          text: '#7adcf2',      // accent text on dark
          on: '#06222b',        // text on cyan
          card: '#10262d',      // accent tint card bg
          border: '#1f5566',    // accent tint card border
        },

        gain: { DEFAULT: '#5fd09a', bg: '#12301f' },
        loss: { DEFAULT: '#f39a5b', bg: '#3a2412' },

        explore: '#b79cf2',
        practice: { DEFAULT: '#f0c56a', bg: '#3a2e12' },
      },
      fontFamily: {
        // Per-weight families — RN custom fonts are one family per weight.
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
        mono: ['JetBrainsMono_500Medium'],
        'mono-semibold': ['JetBrainsMono_600SemiBold'],
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
        'btn-lg': '14px',
        pill: '999px',
      },
      spacing: {
        screen: '20px',   // screen padding
        'card-pad': '16px',
      },
    },
  },
  plugins: [],
}
