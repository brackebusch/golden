import type { Cell, ColumnProfile, DatasetProfile, QueryResult } from '@shared/types'
import { COUNT_ROWS, type QuerySpec } from '@shared/querySpec'
import { cache } from '../cache'
import { lit, resourceUrl, sodaGet } from './http'

/** Hard cap on groups fetched in one request; top-N happens after. */
const FETCH_LIMIT = 50_000
/** Max series (colors) shown; the rest are dropped with a notice. */
export const SERIES_LIMIT = 10

const GRAIN_FN = { year: 'date_trunc_y', month: 'date_trunc_ym', day: 'date_trunc_ymd' } as const

export function compileQuery(p: DatasetProfile, spec: QuerySpec): Record<string, string> {
  const col = (name: string): ColumnProfile => {
    const c = p.columns.find((x) => x.fieldName === name)
    if (!c) throw new Error(`Unknown column "${name}"`)
    return c
  }
  const num = (c: ColumnProfile) => (c.numericText ? `${c.fieldName}::number` : c.fieldName)
  const where: string[] = []
  const excludeNullTokens = (c: ColumnProfile) => {
    where.push(`${c.fieldName} IS NOT NULL`)
    if (c.nullTokens.length) where.push(`${c.fieldName} NOT IN (${c.nullTokens.map(lit).join(', ')})`)
  }

  const select: string[] = []
  const group: string[] = []

  if (spec.dimension) {
    const c = col(spec.dimension.column)
    const expr = spec.dimension.grain && c.kinds.includes('time') ? `${GRAIN_FN[spec.dimension.grain]}(${c.fieldName})` : c.fieldName
    select.push(`${expr} AS dim`)
    group.push(expr)
    excludeNullTokens(c)
  }
  if (spec.series) {
    const c = col(spec.series)
    select.push(`${c.fieldName} AS series`)
    group.push(c.fieldName)
    excludeNullTokens(c)
  }
  spec.measures.forEach((m, i) => {
    if (m.column === COUNT_ROWS) {
      select.push(`count(*) AS m${i}`)
      return
    }
    const c = col(m.column)
    select.push(
      m.agg === 'count'
        ? `count(${c.fieldName}) AS m${i}`
        : m.agg === 'count_distinct'
          ? `count(distinct ${c.fieldName}) AS m${i}`
          : `${m.agg}(${num(c)}) AS m${i}`,
    )
    if (c.numericText || c.nullTokens.length) excludeNullTokens(c)
  })

  for (const f of spec.filters) {
    const c = col(f.column)
    switch (f.op) {
      case 'in':
        where.push(`${c.fieldName} IN (${f.values.map(lit).join(', ')})`)
        break
      case 'not_in':
        where.push(`${c.fieldName} NOT IN (${f.values.map(lit).join(', ')})`)
        break
      case 'contains':
        where.push(`upper(${c.fieldName}) LIKE upper(${lit(`%${f.value}%`)})`)
        break
      case 'range':
        if (f.min == null && f.max == null) break
        excludeNullTokens(c)
        if (f.min != null) where.push(`${num(c)} >= ${Number(f.min)}`)
        if (f.max != null) where.push(`${num(c)} <= ${Number(f.max)}`)
        break
    }
  }

  const params: Record<string, string> = {
    $select: select.join(', '),
    $limit: String(FETCH_LIMIT),
    $order: spec.sort.startsWith('dimension') ? 'dim ASC' : `m0 ${spec.sort === 'measure_asc' ? 'ASC' : 'DESC'}`,
  }
  if (group.length) params.$group = group.join(', ')
  const uniqueWhere = [...new Set(where)]
  if (uniqueWhere.length) params.$where = uniqueWhere.join(' AND ')
  return params
}

const toNumber = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const compareDims = (a: Cell, b: Cell) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
}

export async function runQuery(p: DatasetProfile, spec: QuerySpec): Promise<QueryResult> {
  const params = compileQuery(p, spec)
  const key = `query:${p.id}:${JSON.stringify(params)}`
  console.log(`[query] ${p.id} ${JSON.stringify(params)}`)
  const raw = await cache.getOrSet(key, 10 * 60_000, () => sodaGet<Record<string, string>[]>(resourceUrl(p.id), params))

  const dimCol = spec.dimension && p.columns.find((c) => c.fieldName === spec.dimension!.column)
  const dimIsNumber = !!dimCol && dimCol.kinds.includes('number') && !dimCol.kinds.includes('time')
  const rows = raw.map((r) => {
    const row: Record<string, Cell> = {}
    if ('dim' in r || spec.dimension) {
      const d = r.dim ?? null
      row.dim = dimIsNumber ? toNumber(d) : d && dimCol?.kinds.includes('time') ? d.slice(0, 10) : d
    }
    if (spec.series) row.series = r.series ?? null
    spec.measures.forEach((_, i) => (row[`m${i}`] = toNumber(r[`m${i}`])))
    return row
  })
  const hitFetchCap = raw.length >= FETCH_LIMIT
  const byDimension = spec.sort.startsWith('dimension')
  const dir = spec.sort.endsWith('desc') ? -1 : 1

  if (!spec.series) {
    if (byDimension) rows.sort((a, b) => dir * compareDims(a.dim, b.dim))
    return {
      rows: rows.slice(0, spec.limit),
      totalGroups: rows.length,
      truncated: hitFetchCap || rows.length > spec.limit,
    }
  }

  // With a series: rank dimension values and series by their total of the first measure.
  const totals = (key: 'dim' | 'series') => {
    const t = new Map<Cell, number>()
    for (const r of rows) t.set(r[key], (t.get(r[key]) ?? 0) + ((r.m0 as number) ?? 0))
    return t
  }
  const dimTotals = totals('dim')
  const dims = [...dimTotals.keys()].sort((a, b) => (byDimension ? dir * compareDims(a, b) : dir * (dimTotals.get(a)! - dimTotals.get(b)!)))
  const seriesTotals = totals('series')
  const series = [...seriesTotals.keys()].sort((a, b) => seriesTotals.get(b)! - seriesTotals.get(a)!)

  const keepDims = new Set(dims.slice(0, spec.limit))
  const keepSeries = new Set(series.slice(0, SERIES_LIMIT))
  const order = new Map(dims.map((d, i) => [d, i]))
  const kept = rows.filter((r) => keepDims.has(r.dim) && keepSeries.has(r.series)).sort((a, b) => order.get(a.dim)! - order.get(b.dim)!)

  return {
    rows: kept,
    totalGroups: dims.length,
    totalSeries: series.length,
    truncated: hitFetchCap || dims.length > spec.limit || series.length > SERIES_LIMIT,
  }
}

export async function distinctValues(p: DatasetProfile, column: string, q: string, limit = 50) {
  const c = p.columns.find((x) => x.fieldName === column)
  if (!c) throw new Error(`Unknown column "${column}"`)
  const where = [`${c.fieldName} IS NOT NULL`]
  if (q.trim() && c.socrataType === 'text') where.push(`upper(${c.fieldName}) LIKE upper(${lit(`%${q.trim()}%`)})`)
  const params = {
    $select: `${c.fieldName} AS value, count(*) AS count`,
    $group: c.fieldName,
    $where: where.join(' AND '),
    $order: 'count DESC',
    $limit: String(limit),
  }
  const raw = await cache.getOrSet(`values:${p.id}:${JSON.stringify(params)}`, 30 * 60_000, () =>
    sodaGet<{ value: string; count: string }[]>(resourceUrl(p.id), params),
  )
  return raw.map((r) => ({ value: String(r.value), count: Number(r.count) }))
}

/** Which of `values` don't exist in `column` (catches invented or misspelled filter values). */
export async function findMissingValues(p: DatasetProfile, column: string, values: string[]): Promise<string[]> {
  const c = p.columns.find((x) => x.fieldName === column)
  if (!c || values.length === 0) return []
  const complete = (c.cardinality ?? Infinity) <= c.topValues.length
  if (complete) return values.filter((v) => !c.topValues.some((t) => t.value === v))
  const params = {
    $select: `${c.fieldName} AS value`,
    $group: c.fieldName,
    $where: `${c.fieldName} IN (${values.map(lit).join(', ')})`,
    $limit: String(values.length + 1),
  }
  const found = await cache.getOrSet(`exists:${p.id}:${JSON.stringify(params)}`, 30 * 60_000, () =>
    sodaGet<{ value: string }[]>(resourceUrl(p.id), params),
  )
  const have = new Set(found.map((r) => String(r.value)))
  return values.filter((v) => !have.has(v))
}
