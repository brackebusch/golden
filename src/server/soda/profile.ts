import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ColumnKind, ColumnProfile, DatasetProfile } from '@shared/types'
import type { Filter } from '@shared/querySpec'
import { cache } from '../cache'
import { classifyColumns, type Classification } from '../ai/classify'
import { heuristicRole } from './columnRoles'
import { ROLE_AGGS } from '@shared/querySpec'
import { lit, resourceUrl, SodaError, sodaGet, viewUrl } from './http'

const NUMERIC_TYPES = new Set(['number', 'money', 'percent', 'double'])
const TIME_TYPES = new Set(['calendar_date', 'floating_timestamp', 'fixed_timestamp', 'date'])
const CATEGORY_TYPES = new Set(['text', 'checkbox', 'url'])

/** Strings that mean "no value" in WA open data. */
const NULL_TOKEN_RE = /^(null|n\/?a|none|\*+|-+|n\s*<\s*\d+|<\s*\d+|suppressed|redacted)$/i
/** Values that summarize other rows. */
const ROLLUP_RE = /^(all|all [a-z]+|total|grand total|statewide|state total|state)$/i
const NUMBER_RE = /^-?\d+(\.\d+)?$/
/** Numeric columns with this many distinct values or fewer can also be used as categories. */
const NUMERIC_CATEGORY_MAX = 50
/** cachedContents.top holds at most this many values. */
const TOP_CAP = 20

interface ViewColumn {
  fieldName: string
  name: string
  description?: string
  dataTypeName: string
  cachedContents?: {
    top?: { item: unknown; count: string | number }[]
    smallest?: unknown
    largest?: unknown
  }
}
interface ViewMeta {
  id: string
  name: string
  description?: string
  rowsUpdatedAt?: number
  columns: ViewColumn[]
}

/** Optional hand-written hints in datasets/<id>.json. */
interface DatasetNotes {
  notes?: string
  defaultFilters?: Filter[]
  suggested?: DatasetProfile['suggested']
  columns?: Record<
    string,
    Partial<
      Pick<
        ColumnProfile,
        'label' | 'description' | 'rollupValues' | 'nullTokens' | 'numericText' | 'hidden' | 'kinds' | 'role' | 'aggs' | 'defaultAgg'
      >
    >
  >
}

function loadNotes(id: string): DatasetNotes {
  const file = path.resolve('datasets', `${id}.json`)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DatasetNotes
  } catch (e) {
    console.error(`[profile] bad notes file ${file}:`, e)
    return {}
  }
}

const str = (v: unknown) => (v == null ? undefined : String(v))

export function getProfile(id: string): Promise<DatasetProfile> {
  return cache.getOrSet(`profile:${id}`, 60 * 60_000, () => buildProfile(id))
}

async function buildProfile(id: string): Promise<DatasetProfile> {
  const meta = await sodaGet<ViewMeta>(viewUrl(id))
  const rawCols = meta.columns.filter((c) => !c.fieldName.startsWith(':'))

  // Row count, then (best effort) exact distinct counts for text columns whose top list is capped.
  // count(distinct) can be slow on large datasets, so it gets a short timeout and is skipped on failure.
  const [rows] = await sodaGet<{ n: string }[]>(resourceUrl(id), { $select: 'count(*) as n' })
  const needDistinct = rawCols.filter((c) => c.dataTypeName === 'text' && (c.cachedContents?.top?.length ?? TOP_CAP) >= TOP_CAP)
  const distinct = new Map<string, number>()
  if (needDistinct.length) {
    try {
      const [counts] = await sodaGet<Record<string, string>[]>(
        resourceUrl(id),
        { $select: needDistinct.map((c, i) => `count(distinct ${c.fieldName}) as d${i}`).join(', ') },
        8_000,
      )
      needDistinct.forEach((c, i) => distinct.set(c.fieldName, Number(counts?.[`d${i}`])))
    } catch {
      console.warn(`[profile] ${id}: distinct counts skipped (slow dataset)`)
    }
  }

  const notes = loadNotes(id)
  const columns = rawCols.map((c) => {
    const col = profileColumn(c, distinct.get(c.fieldName))
    const override = notes.columns?.[c.fieldName]
    return override ? { ...col, ...override } : col
  })
  const rowCount = Number(rows?.n ?? 0)
  const [classification] = await Promise.all([
    classifyColumns(
      { id, name: meta.name, description: meta.description ?? '', rowCount },
      columns.filter((c) => !c.hidden),
    ),
    ...columns.filter((c) => c.numericText).map((c) => fillNumericRange(id, c)),
  ])
  applyRoles(columns, classification, notes)
  const suggested = notes.suggested ?? suggestionsFrom(classification, columns)

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description ?? '',
    rowCount,
    updatedAt: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : undefined,
    columns,
    notes: notes.notes,
    defaultFilters: notes.defaultFilters,
    ...(suggested ? { suggested } : {}),
  }
}

/** Heuristics first, then the AI's classification (sanity-checked), then the notes file wins. */
function applyRoles(columns: ColumnProfile[], ai: Classification | null, notes: DatasetNotes) {
  const byField = new Map(ai?.columns.map((c) => [c.field, c]))
  for (const c of columns) {
    Object.assign(c, heuristicRole(c), { roleSource: 'heuristic' })
    const a = byField.get(c.fieldName)
    if (a && c.kinds.includes('number')) {
      if (a.role === 'measure') {
        const aggs = a.aggregations.length ? a.aggregations : ROLE_AGGS.measure.aggs
        const defaultAgg = a.default_aggregation && aggs.includes(a.default_aggregation) ? a.default_aggregation : aggs[0]
        Object.assign(c, { role: 'measure', aggs, defaultAgg, roleSource: 'ai' })
      } else if (a.role === 'identifier' || a.role === 'ordinal') {
        Object.assign(c, { role: a.role, ...ROLE_AGGS[a.role], roleSource: 'ai' })
      }
    }
    const o = notes.columns?.[c.fieldName]
    if (o && (o.role || o.aggs || o.defaultAgg)) {
      if (o.role) c.role = o.role
      if (o.role === 'identifier' || o.role === 'ordinal') c.aggs = [...ROLE_AGGS[o.role].aggs]
      if (o.role === 'other') c.aggs = []
      if (o.aggs) c.aggs = o.aggs
      c.defaultAgg = o.defaultAgg ?? (c.aggs.includes(c.defaultAgg!) ? c.defaultAgg : c.aggs[0])
      c.roleSource = 'notes'
    }
  }
}

function suggestionsFrom(ai: Classification | null, columns: ColumnProfile[]): DatasetProfile['suggested'] {
  if (!ai) return undefined
  const ok = (f: string | null) => (f && columns.some((c) => c.fieldName === f && !c.hidden) ? f : undefined)
  const measure = ok(ai.primary_measure)
  const dimension = ok(ai.primary_dimension)
  return measure || dimension ? { measure, dimension } : undefined
}

/** Real min/max for numbers stored as text (string comparison gives wrong answers). */
async function fillNumericRange(id: string, c: ColumnProfile) {
  const where = [`${c.fieldName} IS NOT NULL`]
  if (c.nullTokens.length) where.push(`${c.fieldName} NOT IN (${c.nullTokens.map(lit).join(', ')})`)
  try {
    const [r] = await sodaGet<Record<string, string>[]>(
      resourceUrl(id),
      {
        $select: `min(${c.fieldName}::number) as lo, max(${c.fieldName}::number) as hi`,
        $where: where.join(' AND '),
      },
      8_000,
    )
    c.min = r?.lo
    c.max = r?.hi
  } catch (e) {
    // A 400 means the cast failed on an unknown placeholder value: treat the column as text.
    if (e instanceof SodaError && e.status === 400) {
      c.numericText = false
      c.kinds = ['category']
    }
  }
}

function profileColumn(c: ViewColumn, distinctCount: number | undefined): ColumnProfile {
  const type = c.dataTypeName
  const top = (c.cachedContents?.top ?? []).map((t) => ({ value: String(t.item), count: Number(t.count) }))
  const cardinality = top.length < TOP_CAP && top.length > 0 ? top.length : distinctCount

  const nullTokens = top.map((t) => t.value).filter((v) => NULL_TOKEN_RE.test(v.trim()))
  const realValues = [str(c.cachedContents?.smallest), str(c.cachedContents?.largest), ...top.map((t) => t.value)].filter(
    (v): v is string => v != null && !nullTokens.includes(v),
  )
  const numericText = type === 'text' && realValues.length > 0 && realValues.every((v) => NUMBER_RE.test(v.trim()))

  const kinds: ColumnKind[] = []
  const isNumber = NUMERIC_TYPES.has(type) || numericText
  if (TIME_TYPES.has(type)) kinds.push('time')
  if (isNumber) kinds.push('number')
  if ((CATEGORY_TYPES.has(type) && !numericText) || (isNumber && (cardinality ?? Infinity) <= NUMERIC_CATEGORY_MAX)) kinds.push('category')

  const rollupValues = kinds.includes('category') && !isNumber ? top.map((t) => t.value).filter((v) => ROLLUP_RE.test(v.trim())) : []

  // For numeric text, smallest/largest are compared as strings; buildProfile fills real values in.
  const min = numericText ? undefined : str(c.cachedContents?.smallest)
  const max = numericText ? undefined : str(c.cachedContents?.largest)

  return {
    fieldName: c.fieldName,
    label: c.name,
    description: c.description || undefined,
    socrataType: type,
    kinds,
    numericText,
    cardinality,
    topValues: top,
    min,
    max,
    rollupValues,
    nullTokens,
    hidden: kinds.length === 0 || cardinality === 1,
    role: 'other',
    aggs: [],
    roleSource: 'heuristic',
  }
}
