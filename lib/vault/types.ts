export interface VaultFrontmatter {
  created: string
  updated: string
  tags: string[]
}

export interface DecisionFrontmatter extends VaultFrontmatter {
  type: 'decision'
  symbol: string
  action: 'buy' | 'sell' | 'hold'
  decision: 'execute' | 'reduce' | 'defer' | 'reject'
  finalScore: number
  confidence: number
  accountPlacement: string
}

export interface ResearchFrontmatter extends VaultFrontmatter {
  type: 'research'
  ticker?: string
  sector?: string
  source?: string
}

export interface OutcomeFrontmatter extends VaultFrontmatter {
  type: 'outcome'
  symbol: string
  originalDecision: 'execute' | 'reduce' | 'defer' | 'reject'
  entryDate: string
  exitDate?: string
  pnlPct?: number
  hitTarget?: boolean
}

export interface VaultNote<F extends VaultFrontmatter = VaultFrontmatter> {
  path: string
  sha: string
  frontmatter: F
  body: string
  wikilinks: string[]
}

export function extractWikilinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)
  return [...new Set([...matches].map(m => m[1].trim()))]
}
