/**
 * Chain-of-thought prefix prepended to every agent prompt template.
 *
 * Forces explicit structured reasoning before the agent reaches a verdict,
 * reducing shortcut heuristics and improving calibration across all 4
 * AutoHedge-derived roles (Director CIO, Quant Analyst, Risk Manager, Execution Trader).
 *
 * Usage: CHAIN_OF_THOUGHT_PREFIX + DIRECTOR_CIO_PROMPT (etc.)
 */

export const CHAIN_OF_THOUGHT_PREFIX = `Before answering, follow this structure:
1. List the 5 most important factors for this analysis.
2. Evaluate each factor independently.
3. Synthesize.
4. Give a verdict.
5. State your confidence (0-100) and the 3 conditions that would invalidate it.

Then proceed to the analysis below.

`
