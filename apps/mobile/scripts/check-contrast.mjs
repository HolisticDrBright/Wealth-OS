// WCAG contrast check for every text/background token pair the Simple-mode
// screens actually use. Reads src/theme.ts so it can't drift from the tokens.
// Run: npm run a11y:contrast   (exits 1 on any pair below 4.5:1)
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8')
const t = Object.fromEntries([...src.matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi)].map(m => [m[1], m[2]]))

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const PAIRS = [
  ['ink', ['ground', 'card', 'inset', 'accentCard', 'lossBg']],
  ['inkBody', ['ground', 'card', 'lossBg', 'stroke']],
  ['inkSecondary', ['ground', 'card', 'inset', 'accentCard']],
  ['inkMuted', ['ground', 'card', 'inset']],
  ['accent', ['ground', 'card']],
  ['accentText', ['ground', 'accentCard', 'inset']],
  ['gain', ['ground', 'gainBg', 'card']],
  ['loss', ['ground', 'lossBg', 'card']],
  ['practice', ['practiceBg']],
  ['explore', ['card']],
  ['accentOn', ['accent']],
]

let failed = 0
for (const [fg, bgs] of PAIRS) {
  for (const bg of bgs) {
    const r = ratio(t[fg], t[bg])
    const ok = r >= 4.5
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${fg.padEnd(13)} on ${bg.padEnd(11)} ${r.toFixed(2)}:1`)
  }
}
// Caution button text (#2a1404) on caution orange.
const caution = ratio('#2a1404', t.loss)
console.log(`${caution >= 4.5 ? 'PASS' : 'FAIL'}  cautionText   on loss        ${caution.toFixed(2)}:1`)
if (caution < 4.5) failed++

process.exit(failed ? 1 : 0)
