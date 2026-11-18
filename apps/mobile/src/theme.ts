/**
 * Raw token values (Phase M1) for the few places that need literal colors —
 * navigator options, SVG strokes, RN props that can't take a className.
 * These MUST mirror tailwind.config.js; change them together.
 */

export const colors = {
  ground: '#0b0d12',
  card: '#161922',
  inset: '#0f1218',
  stroke: '#262b38',

  ink: '#f4f5f8',
  inkBody: '#dfe1e7',
  inkSecondary: '#b9bcc6',
  inkMuted: '#9a9eaa',

  accent: '#3cc8e6',
  accentText: '#7adcf2',
  accentOn: '#06222b',
  accentCard: '#10262d',
  accentBorder: '#1f5566',

  gain: '#5fd09a',
  gainBg: '#12301f',
  loss: '#f39a5b',
  lossBg: '#3a2412',

  explore: '#b79cf2',
  practice: '#f0c56a',
  practiceBg: '#3a2e12',
} as const

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoSemibold: 'JetBrainsMono_600SemiBold',
} as const
