import type { ColumnKind, ColumnProfile, DatasetProfile } from './types'
import { COUNT_ROWS, type Aggregation, type ChartType, type Filter, type Measure, type QuerySpec, type Sort } from './querySpec'

export interface SlotDef {
  label: string
  help?: string
  accepts: ColumnKind[]
}

export interface Requirement {
  kinds: ColumnKind[]
  count: number
  /** Human description of what's needed, e.g. "a date or numeric column". */
  need: string
  /** Only count measure columns (numeric quantities, not ids or years). */
  measures?: boolean
}

export interface ChartDef {
  type: ChartType
  label: string
  description: string
  dimension: SlotDef
  measures: { min: number; max: number; labels: string[] }
  series: SlotDef | null
  sorts: Sort[]
  defaultSort: Sort
  defaultLimit: number
  requirements: Requirement[]
}

export const CHARTS: Record<ChartType, ChartDef> = {
  bar: {
    type: 'bar',
    label: 'Bar',
    description: 'Compare values across categories',
    dimension: { label: 'Categories (x axis)', accepts: ['category', 'time'] },
    measures: { min: 1, max: 3, labels: ['Value', 'Value 2', 'Value 3'] },
    series: { label: 'Split by (optional)', accepts: ['category'] },
    sorts: ['measure_desc', 'measure_asc', 'dimension_asc', 'dimension_desc'],
    defaultSort: 'measure_desc',
    defaultLimit: 20,
    requirements: [{ kinds: ['category', 'time'], count: 1, need: 'a category or date column' }],
  },
  line: {
    type: 'line',
    label: 'Line',
    description: 'Show how values change over an ordered axis',
    dimension: {
      label: 'X axis (ordered)',
      help: 'A date or numeric column',
      accepts: ['time', 'number'],
    },
    measures: { min: 1, max: 3, labels: ['Value', 'Value 2', 'Value 3'] },
    series: { label: 'One line per (optional)', accepts: ['category'] },
    sorts: ['dimension_asc'],
    defaultSort: 'dimension_asc',
    defaultLimit: 100,
    requirements: [{ kinds: ['time', 'number'], count: 1, need: 'a date or numeric column' }],
  },
  scatter: {
    type: 'scatter',
    label: 'Scatter',
    description: 'Compare two numeric values; one point per group',
    dimension: { label: 'One point per', accepts: ['category'] },
    measures: { min: 2, max: 2, labels: ['X value', 'Y value'] },
    series: { label: 'Color by (optional)', accepts: ['category'] },
    sorts: ['measure_desc', 'measure_asc'],
    defaultSort: 'measure_desc',
    defaultLimit: 200,
    requirements: [
      { kinds: ['number'], count: 2, need: 'two numeric measures', measures: true },
      { kinds: ['category'], count: 1, need: 'a category column' },
    ],
  },
  pie: {
    type: 'pie',
    label: 'Pie',
    description: 'Show parts of a whole',
    dimension: { label: 'Slices', accepts: ['category'] },
    measures: { min: 1, max: 1, labels: ['Value'] },
    series: null,
    sorts: ['measure_desc', 'measure_asc'],
    defaultSort: 'measure_desc',
    defaultLimit: 10,
    requirements: [{ kinds: ['category'], count: 1, need: 'a category column' }],
  },
}

export const CHART_LIST = Object.values(CHARTS)

const visible = (p: DatasetProfile) => p.columns.filter((c) => !c.hidden)
const accepts = (c: ColumnProfile, kinds: ColumnKind[]) => c.kinds.some((k) => kinds.includes(k))

/** Columns that can fill a slot. */
export const columnsFor = (p: DatasetProfile, kinds: ColumnKind[]) => visible(p).filter((c) => accepts(c, kinds))

/**
 * Columns usable as a value: numeric quantities (role "measure"), never ids, codes or years.
 * "Number of rows" (COUNT_ROWS) is always available too.
 */
export const measureColumns = (p: DatasetProfile) => columnsFor(p, ['number']).filter((c) => c.role === 'measure')

/** Aggregations that make sense for a measure column ("Number of rows" only counts). */
export function aggsFor(p: DatasetProfile, column: string): Aggregation[] {
  if (column === COUNT_ROWS) return ['count']
  return p.columns.find((c) => c.fieldName === column)?.aggs ?? []
}

/** A measure for a column, keeping the current aggregation when it still makes sense. */
export function measureFor(p: DatasetProfile, column: string, keepAgg?: Aggregation): Measure {
  if (column === COUNT_ROWS) return { column, agg: 'count' }
  const c = p.columns.find((x) => x.fieldName === column)
  const aggs = c?.aggs ?? []
  const agg = keepAgg && aggs.includes(keepAgg) ? keepAgg : (c?.defaultAgg ?? aggs[0] ?? 'avg')
  return { column, agg }
}

export interface Compatibility {
  ok: boolean
  reason?: string
}

export function checkCompatibility(p: DatasetProfile, chartType: ChartType): Compatibility {
  const chart = CHARTS[chartType]
  const missing = chart.requirements.filter((r) => (r.measures ? measureColumns(p) : columnsFor(p, r.kinds)).length < r.count)
  if (missing.length === 0) return { ok: true }
  return {
    ok: false,
    reason: `${chart.label} charts need ${missing.map((m) => m.need).join(' and ')}, which "${p.name}" doesn't have.`,
  }
}

const col = (p: DatasetProfile, name: string) => p.columns.find((c) => c.fieldName === name)

/** Every problem with a spec, as human-readable messages. Empty means valid. */
export function validateSpec(p: DatasetProfile, spec: QuerySpec): string[] {
  const errors: string[] = []
  const chart = CHARTS[spec.chartType]
  if (spec.datasetId !== p.id) errors.push(`datasetId must be "${p.id}".`)
  const compat = checkCompatibility(p, spec.chartType)
  if (!compat.ok) return [compat.reason!]

  if (!spec.dimension) errors.push(`${chart.dimension.label} is required.`)
  else {
    const c = col(p, spec.dimension.column)
    if (!c) errors.push(`Unknown column "${spec.dimension.column}".`)
    else if (!accepts(c, chart.dimension.accepts))
      errors.push(`"${c.label}" can't be used as ${chart.dimension.label} (needs ${chart.dimension.accepts.join(' or ')}).`)
    if (spec.dimension.grain && c && !c.kinds.includes('time')) errors.push(`A time grain only applies to date columns.`)
  }

  if (spec.measures.length < chart.measures.min || spec.measures.length > chart.measures.max)
    errors.push(
      chart.measures.min === chart.measures.max
        ? `${chart.label} charts need exactly ${chart.measures.min} value(s).`
        : `${chart.label} charts take ${chart.measures.min}-${chart.measures.max} values.`,
    )
  spec.measures.forEach((m, i) => {
    if (m.column === COUNT_ROWS) {
      if (m.agg !== 'count') errors.push(`Value ${i + 1}: "*" only supports the count aggregation.`)
      return
    }
    const c = col(p, m.column)
    if (!c) errors.push(`Value ${i + 1}: unknown column "${m.column}".`)
    else if (c.role !== 'measure' || !c.kinds.includes('number'))
      errors.push(
        `Value ${i + 1}: "${c.label}" is ${c.role === 'identifier' ? 'an identifier or code' : c.role === 'ordinal' ? 'a year or sequence' : 'not a numeric quantity'}, so aggregating it isn't meaningful. Use "*" (count rows) or a measure column.`,
      )
    else if (!c.aggs.includes(m.agg)) errors.push(`Value ${i + 1}: ${m.agg} of "${c.label}" isn't meaningful (use ${c.aggs.join(', ')}).`)
  })

  if (spec.series) {
    const c = col(p, spec.series)
    if (!chart.series) errors.push(`${chart.label} charts don't support a series.`)
    else if (!c) errors.push(`Unknown series column "${spec.series}".`)
    else if (!accepts(c, chart.series.accepts)) errors.push(`"${c.label}" can't be used to split series.`)
    if (spec.series === spec.dimension?.column) errors.push(`Series must differ from ${chart.dimension.label}.`)
    if (spec.chartType !== 'scatter' && spec.measures.length > 1) errors.push(`When splitting by a column, only one value can be shown.`)
  }

  for (const f of spec.filters) {
    const c = col(p, f.column)
    if (!c) {
      errors.push(`Filter on unknown column "${f.column}".`)
      continue
    }
    if (f.op === 'range' && !c.kinds.includes('number')) errors.push(`Range filter needs a numeric column; "${c.label}" isn't.`)
    if ((f.op === 'in' || f.op === 'not_in') && f.values.length === 0) errors.push(`Choose at least one value for the "${c.label}" filter.`)
    if (f.op === 'contains' && !f.value.trim()) errors.push(`Enter text for the "${c.label}" filter.`)
  }

  if (!chart.sorts.includes(spec.sort))
    errors.push(`Sort "${spec.sort}" isn't available for ${chart.label} charts (use ${chart.sorts.join(', ')}).`)
  return errors
}

/**
 * Starting filters for a new spec: the dataset notes' defaults when present, otherwise
 * exclusions of detected rollup rows ("All", "Statewide") to avoid double counting.
 */
export function rollupFilters(p: DatasetProfile): Filter[] {
  if (p.defaultFilters) return structuredClone(p.defaultFilters)
  return p.columns
    .filter((c) => c.rollupValues.length > 0)
    .map((c) => ({ op: 'not_in', column: c.fieldName, values: c.rollupValues, rollup: true }))
}

function pickDimension(p: DatasetProfile, chart: ChartDef, avoid: string[] = []) {
  const options = columnsFor(p, chart.dimension.accepts).filter((c) => !avoid.includes(c.fieldName))
  const suggested = options.find((c) => c.fieldName === p.suggested?.dimension)
  if (suggested && chart.type !== 'line') return suggested
  const score = (c: ColumnProfile) => {
    // Lines read best over dates, then years/sequences; ids and raw quantities make poor x axes.
    if (chart.type === 'line') return c.kinds.includes('time') ? 0 : c.role === 'ordinal' ? 1 : c.role === 'identifier' ? 3 : 2
    const n = c.cardinality ?? 1000
    if (n < 2) return 9
    // Prefer readable category counts: 3-40 groups.
    return n <= 40 ? 0 : n <= 200 ? 1 : 2
  }
  return [...options].sort((a, b) => score(a) - score(b))[0]
}

function defaultMeasures(p: DatasetProfile, chart: ChartDef, avoid: string[]): Measure[] {
  // The suggested measure first, then continuous numbers before low-cardinality ones.
  const rank = (c: ColumnProfile) => (c.fieldName === p.suggested?.measure ? -1 : Number(c.kinds.includes('category')))
  const nums = measureColumns(p)
    .filter((c) => !avoid.includes(c.fieldName))
    .sort((a, b) => rank(a) - rank(b))
  const out: Measure[] = []
  for (let i = 0; i < chart.measures.min; i++) {
    const c = nums[i]
    out.push(c ? measureFor(p, c.fieldName) : { column: COUNT_ROWS, agg: 'count' })
  }
  return out
}

/** A sensible starting spec for a dataset + chart type. */
export function defaultSpec(p: DatasetProfile, chartType: ChartType): QuerySpec {
  const chart = CHARTS[chartType]
  const dim = pickDimension(p, chart)
  return {
    datasetId: p.id,
    chartType,
    dimension: dim ? { column: dim.fieldName, ...(dim.kinds.includes('time') ? { grain: 'year' as const } : {}) } : null,
    measures: defaultMeasures(p, chart, dim ? [dim.fieldName] : []),
    series: null,
    filters: rollupFilters(p),
    sort: chart.defaultSort,
    limit: chart.defaultLimit,
  }
}

/** Switch chart type, keeping whatever from the previous spec still fits. */
export function reconcileSpec(p: DatasetProfile, prev: QuerySpec | null, chartType: ChartType): QuerySpec {
  const next = defaultSpec(p, chartType)
  if (!prev || prev.datasetId !== p.id) return next
  const chart = CHARTS[chartType]
  next.filters = prev.filters

  const prevDim = prev.dimension && col(p, prev.dimension.column)
  if (prevDim && accepts(prevDim, chart.dimension.accepts)) next.dimension = prev.dimension

  const usable = new Set([COUNT_ROWS, ...measureColumns(p).map((c) => c.fieldName)])
  const keep = prev.measures
    .filter((m) => m.column !== next.dimension?.column && usable.has(m.column))
    .map((m) => measureFor(p, m.column, m.agg))
    .slice(0, chart.measures.max)
  if (keep.length >= chart.measures.min) next.measures = keep
  else if (keep.length > 0) next.measures = [...keep, ...next.measures.slice(keep.length)]

  const prevSeries = prev.series && col(p, prev.series)
  if (chart.series && prevSeries && accepts(prevSeries, chart.series.accepts) && prev.series !== next.dimension?.column)
    next.series = prev.series

  if (chart.sorts.includes(prev.sort)) next.sort = prev.sort
  return next
}
