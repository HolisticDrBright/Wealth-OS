'use client'

/**
 * Glossary tooltip (Phase 3.5) — any finance term that must appear in simple
 * mode gets a plain-English definition on tap/hover. Keyboard accessible:
 * it's a real button with aria-describedby.
 */

import { useId, useState } from 'react'

export const GLOSSARY: Record<string, string> = {
  rebalance: 'Selling a little of what has grown and buying what has lagged, so your mix stays the one you chose.',
  diversified: 'Spread across many investments so no single one can sink you.',
  'practice money': 'Simulated trades with no real dollars at risk. Used to test strategies before any real money is ever involved.',
  'loss limit': 'A pre-set point where a position is sold automatically to keep one bad pick from hurting the whole account.',
  'profit target': 'A pre-set point where a position is sold automatically to lock in its gain.',
  volatility: 'How much an investment’s value swings up and down over time.',
  'index fund': 'A low-cost fund that owns a whole market at once instead of picking single stocks.',
  'core portfolio': 'The main part of your money: broad, low-cost funds matched to your plan.',
  explore: 'A small, fenced-off part of your money for strategies and copying traders. Your core is never touched.',
}

export function GlossaryTerm({ term, children }: { term: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const definition = GLOSSARY[term.toLowerCase()] ?? null
  const label = children ?? term
  if (!definition) return <>{label}</>

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`What does ${term} mean?`}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="cursor-help underline decoration-dotted decoration-gray-500 underline-offset-2"
      >
        {label}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-lg border border-white/15 bg-bg-3 p-2.5 text-xs leading-relaxed text-gray-200 shadow-xl"
        >
          {definition}
        </span>
      )}
    </span>
  )
}
