import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile, listDirectory, searchVault } from '@/lib/vault/client'
import { VaultConfigError, VaultPathError } from '@/lib/vault/client'

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const VAULT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'vault_read',
    description: 'Read a note from the Obsidian vault by its path. Returns frontmatter, body, and wikilinks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note, e.g. "decisions/2026-04-23-AAPL-execute.md"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'vault_write',
    description: 'Write or update a note in the Obsidian vault. Only allowed under: research/, decisions/, outcomes/, agents/, tickers/, strategies/.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to write, e.g. "research/aapl-analysis.md"',
        },
        content: {
          type: 'string',
          description: 'Full file content including YAML frontmatter (--- ... ---) and markdown body.',
        },
        message: {
          type: 'string',
          description: 'Git commit message describing the change.',
        },
        sha: {
          type: 'string',
          description: 'Current file SHA. Required when updating an existing file; omit for new files.',
        },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'vault_search',
    description: 'Search notes in the Obsidian vault using GitHub code search. Returns ranked paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search terms, e.g. a ticker symbol, theme, or keyword.',
        },
        extension: {
          type: 'string',
          description: 'File extension to filter by. Defaults to ".md".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'vault_list',
    description: 'List files and subdirectories under a vault directory path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list, e.g. "decisions" or "research/macro".',
        },
      },
      required: ['path'],
    },
  },
]

// ─── Input shapes ─────────────────────────────────────────────────────────────

interface VaultReadInput   { path: string }
interface VaultWriteInput  { path: string; content: string; message: string; sha?: string }
interface VaultSearchInput { query: string; extension?: string }
interface VaultListInput   { path: string }

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchVaultTool(
  toolName: string,
  toolInput: unknown,
  callerId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'vault_read': {
        const { path } = toolInput as VaultReadInput
        const note = await readFile(path)
        return JSON.stringify(note)
      }

      case 'vault_write': {
        const { path, content, message, sha } = toolInput as VaultWriteInput
        const result = await writeFile(path, content, message, callerId, sha)
        return JSON.stringify(result)
      }

      case 'vault_search': {
        const { query, extension } = toolInput as VaultSearchInput
        const results = await searchVault(query, extension)
        return JSON.stringify({ results })
      }

      case 'vault_list': {
        const { path } = toolInput as VaultListInput
        const items = await listDirectory(path)
        return JSON.stringify({ items })
      }

      default:
        return JSON.stringify({ error: `Unknown vault tool: ${toolName}` })
    }
  } catch (err) {
    if (err instanceof VaultConfigError) {
      return JSON.stringify({ error: err.message, status: 503 })
    }
    if (err instanceof VaultPathError) {
      return JSON.stringify({ error: err.message, status: 400 })
    }
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

export function isVaultToolName(name: string): boolean {
  return name.startsWith('vault_')
}
