import 'server-only'
import { Octokit } from '@octokit/rest'
import matter from 'gray-matter'
import type { VaultFrontmatter, VaultNote } from './types'
import { extractWikilinks } from './types'

export class VaultConfigError extends Error {
  readonly status = 503
  constructor(msg: string) { super(msg) }
}

export class VaultPathError extends Error {
  readonly status = 400
  constructor(msg: string) { super(msg) }
}

const ALLOWED_PREFIXES = ['research/', 'decisions/', 'outcomes/', 'agents/', 'tickers/', 'strategies/']
const BLOCKED_PREFIXES = ['.obsidian/', 'templates/', '.git/']
const RATE_LIMIT_MS = 10_000

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new VaultConfigError(`Missing env var: ${key}`)
  return val
}

function getClient(): Octokit {
  return new Octokit({ auth: getEnv('VAULT_GITHUB_TOKEN') })
}

function getRepo() {
  return {
    owner: process.env.VAULT_OWNER ?? 'HolisticDrBright',
    repo: process.env.VAULT_REPO ?? 'wealth-os-vault',
    branch: process.env.VAULT_BRANCH ?? 'main',
  }
}

function validatePath(path: string): void {
  const clean = path.replace(/^\/+/, '')
  if (BLOCKED_PREFIXES.some(p => clean.startsWith(p))) {
    throw new VaultPathError(`Path is not writable: ${path}`)
  }
  if (!ALLOWED_PREFIXES.some(p => clean.startsWith(p))) {
    throw new VaultPathError(`Path must be under: ${ALLOWED_PREFIXES.join(', ')}`)
  }
  if (/\.\./.test(clean)) {
    throw new VaultPathError('Path traversal not allowed')
  }
}

const _lastWrite = new Map<string, number>()

function checkRateLimit(callerId: string): void {
  const last = _lastWrite.get(callerId) ?? 0
  const elapsed = Date.now() - last
  if (elapsed < RATE_LIMIT_MS) {
    throw new VaultPathError(`Rate limited: wait ${Math.ceil((RATE_LIMIT_MS - elapsed) / 1000)}s before next write`)
  }
}

function markWrite(callerId: string): void {
  _lastWrite.set(callerId, Date.now())
}

export async function readFile<F extends VaultFrontmatter>(path: string): Promise<VaultNote<F>> {
  const { owner, repo, branch } = getRepo()
  const octokit = getClient()

  const res = await octokit.repos.getContent({ owner, repo, path, ref: branch })
  const data = res.data as { content: string; sha: string }
  const raw = Buffer.from(data.content, 'base64').toString('utf-8')
  const { data: fm, content: body } = matter(raw)

  return {
    path,
    sha: data.sha,
    frontmatter: fm as F,
    body,
    wikilinks: extractWikilinks(body),
  }
}

export async function writeFile(
  path: string,
  content: string,
  message: string,
  callerId: string,
  sha?: string,
): Promise<{ sha: string; path: string }> {
  validatePath(path)
  checkRateLimit(callerId)

  const { owner, repo, branch } = getRepo()
  const octokit = getClient()

  const res = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  })

  markWrite(callerId)

  return { sha: res.data.content?.sha ?? '', path }
}

export async function listDirectory(dirPath: string): Promise<{ name: string; path: string; type: 'file' | 'dir' }[]> {
  const { owner, repo, branch } = getRepo()
  const octokit = getClient()

  const res = await octokit.repos.getContent({ owner, repo, path: dirPath, ref: branch })
  const items = res.data as Array<{ name: string; path: string; type: string }>

  return items.map(i => ({
    name: i.name,
    path: i.path,
    type: i.type === 'dir' ? 'dir' : 'file',
  }))
}

export async function searchVault(query: string, extension = '.md'): Promise<{ path: string; score: number }[]> {
  const { owner, repo } = getRepo()
  const octokit = getClient()

  const q = `${query} extension:${extension.replace(/^\./, '')} repo:${owner}/${repo}`
  const res = await octokit.rest.search.code({ q, per_page: 20 })

  return res.data.items.map((item, i) => ({
    path: item.path,
    score: 1 - i / res.data.items.length,
  }))
}
