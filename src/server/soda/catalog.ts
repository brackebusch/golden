import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatasetSummary } from '@shared/types'
import { cache } from '../cache'
import { config } from '../config'
import { sodaGet } from './http'

/**
 * Dataset search.
 *
 * The Socrata catalog API is slow (~1-5s per search) and heavy (~11KB per result, since it
 * includes every column's metadata). data.wa.gov has only ~1,100 datasets, so instead we
 * download the whole catalog once in the background, keep a slim in-memory index, persist it
 * to .cache/ so restarts are instant, and search it locally. Until the index is ready, searches
 * fall back to the live catalog API.
 */

/** Dataset shown first when the search box is empty. */
export const DEFAULT_DATASET_ID = 'gmgy-gm47'

const CATALOG_URL = 'https://api.us.socrata.com/api/catalog/v1'
const CACHE_FILE = path.resolve('.cache', `catalog-${config.socrataDomain}.json`)
const REFRESH_MS = 12 * 60 * 60_000
const PAGE_SIZE = 200
const RESULT_LIMIT = 30

interface CatalogResult {
  resource: {
    id: string
    name: string
    description?: string
    updatedAt?: string
    page_views?: { page_views_last_month?: number }
    columns_name?: string[]
  }
  classification?: { domain_category?: string; domain_tags?: string[]; tags?: string[] }
}
interface CatalogResponse {
  results: CatalogResult[]
  resultSetSize: number
}

interface IndexEntry extends DatasetSummary {
  views: number
  tags: string[]
  /** Lowercased search fields. */
  _name: string
  _meta: string
  _desc: string
}

let index: IndexEntry[] | null = null
let indexBuiltAt = 0
let building: Promise<void> | null = null

const toSummary = (r: CatalogResult): DatasetSummary => ({
  id: r.resource.id,
  name: r.resource.name,
  description: r.resource.description ?? '',
  category: r.classification?.domain_category,
  updatedAt: r.resource.updatedAt,
})

type StoredEntry = Omit<IndexEntry, '_name' | '_meta' | '_desc'>

const withSearchFields = (e: StoredEntry): IndexEntry => ({
  ...e,
  _name: e.name.toLowerCase(),
  _meta: [e.category ?? '', ...e.tags].join(' ').toLowerCase(),
  _desc: e.description.toLowerCase(),
})

function toEntry(r: CatalogResult): IndexEntry {
  const s = toSummary(r)
  return withSearchFields({
    ...s,
    description: s.description.slice(0, 500),
    views: r.resource.page_views?.page_views_last_month ?? 0,
    tags: [...(r.classification?.domain_tags ?? []), ...(r.classification?.tags ?? [])],
  })
}

function loadFromDisk() {
  if (!existsSync(CACHE_FILE)) return
  try {
    const saved = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as { builtAt: number; entries: StoredEntry[] }
    index = saved.entries.map(withSearchFields)
    indexBuiltAt = saved.builtAt
    console.log(`[catalog] loaded ${index.length} datasets from ${path.relative(process.cwd(), CACHE_FILE)}`)
  } catch (e) {
    console.warn('[catalog] ignoring unreadable cache file:', e)
  }
}

async function buildIndex() {
  const started = Date.now()
  const params = (offset: number) => ({
    domains: config.socrataDomain,
    search_context: config.socrataDomain,
    only: 'dataset',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })
  const first = await sodaGet<CatalogResponse>(CATALOG_URL, params(0), 120_000)
  const offsets: number[] = []
  for (let o = PAGE_SIZE; o < first.resultSetSize; o += PAGE_SIZE) offsets.push(o)
  const rest = await Promise.all(offsets.map((o) => sodaGet<CatalogResponse>(CATALOG_URL, params(o), 120_000)))

  const seen = new Set<string>()
  const entries = [first, ...rest]
    .flatMap((r) => r.results)
    .filter((r) => !seen.has(r.resource.id) && seen.add(r.resource.id))
    .map(toEntry)
  index = entries
  indexBuiltAt = Date.now()

  mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
  const slim = entries.map(({ _name, _meta, _desc, ...e }) => e)
  writeFileSync(CACHE_FILE, JSON.stringify({ builtAt: indexBuiltAt, entries: slim }))
  console.log(`[catalog] indexed ${entries.length} datasets in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

/** Load the index from disk, and (re)build it in the background when missing or stale. */
export function warmCatalog() {
  if (!index) loadFromDisk()
  if (building || (index && Date.now() - indexBuiltAt < REFRESH_MS)) return
  building = buildIndex()
    .catch((e) => console.warn('[catalog] background index build failed; using live search:', e instanceof Error ? e.message : e))
    .finally(() => (building = null))
}

const tokenize = (q: string) => q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const hasWordPrefix = (text: string, token: string) =>
  text.startsWith(token) || text.includes(` ${token}`) || text.includes(`-${token}`) || text.includes(`(${token}`)

/** Every token must match somewhere; name matches outrank tags/category, which outrank description. */
function searchIndex(entries: IndexEntry[], q: string): DatasetSummary[] {
  const tokens = tokenize(q)
  const popularity = (e: IndexEntry) => Math.log10(e.views + 10)
  if (tokens.length === 0) {
    const top = [...entries].sort((a, b) => b.views - a.views).slice(0, RESULT_LIMIT)
    const def = entries.find((e) => e.id === DEFAULT_DATASET_ID)
    return (def && !top.includes(def) ? [def, ...top.slice(0, -1)] : top).map(strip)
  }
  const scored: { e: IndexEntry; score: number }[] = []
  for (const e of entries) {
    let score = 0
    let ok = true
    for (const t of tokens) {
      if (hasWordPrefix(e._name, t)) score += 10
      else if (e._name.includes(t)) score += 6
      else if (hasWordPrefix(e._meta, t)) score += 4
      else if (e._desc.includes(t)) score += 1
      else {
        ok = false
        break
      }
    }
    if (ok) scored.push({ e, score: score + popularity(e) })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map((s) => strip(s.e))
}

const strip = ({ id, name, description, category, updatedAt }: IndexEntry): DatasetSummary => ({ id, name, description, category, updatedAt })

export async function searchDatasets(q: string): Promise<DatasetSummary[]> {
  warmCatalog()
  if (index) return searchIndex(index, q)
  return liveSearch(q.trim())
}

export interface DatasetMatch extends DatasetSummary {
  columns: string[]
}

/**
 * Full-featured search for the AI agent: Socrata's catalog full-text search, which also matches
 * column names and descriptions, and returns each dataset's columns. Slower than the local index,
 * but the agent isn't waiting on keystrokes. Falls back to the local index if the API fails.
 */
export function searchDatasetsWithColumns(q: string): Promise<DatasetMatch[]> {
  const query = q.trim()
  return cache.getOrSet(`catalog-full:${query}`, 10 * 60_000, async () => {
    try {
      const data = await sodaGet<CatalogResponse>(CATALOG_URL, {
        domains: config.socrataDomain,
        search_context: config.socrataDomain,
        only: 'dataset',
        limit: '10',
        q: query,
      })
      return data.results.map((r) => ({ ...toSummary(r), columns: r.resource.columns_name ?? [] }))
    } catch (e) {
      console.warn('[catalog] full search failed; using local index:', e instanceof Error ? e.message : e)
      return (await searchDatasets(query)).map((d) => ({ ...d, columns: [] }))
    }
  })
}

/** Fallback while the local index is being built. */
function liveSearch(query: string): Promise<DatasetSummary[]> {
  return cache.getOrSet(`catalog:${query}`, 10 * 60_000, async () => {
    const params: Record<string, string> = {
      domains: config.socrataDomain,
      search_context: config.socrataDomain,
      only: 'dataset',
      limit: String(RESULT_LIMIT),
    }
    if (query) params.q = query
    else params.order = 'page_views_last_month'
    const data = await sodaGet<CatalogResponse>(CATALOG_URL, params)
    return data.results.map(toSummary)
  })
}
