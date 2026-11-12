import type { Aggregation, Filter } from './querySpec'

/** What a column can be used as in a chart slot. A column may have several. */
export type ColumnKind = 'category' | 'number' | 'time'

/**
 * What a column *means*, which decides whether aggregating it makes sense.
 * - measure: a quantity worth aggregating (earnings, counts, amounts, rates)
 * - identifier: ids, codes, versions, zip codes, coordinates; numeric but never aggregated
 * - ordinal: years or sequence numbers; good on an axis, not as a value
 * - other: everything else (text, dates, flags)
 */
export type ColumnRole = 'measure' | 'identifier' | 'ordinal' | 'other'

export interface TopValue {
  value: string
  count: number
}

export interface ColumnProfile {
  fieldName: string
  label: string
  description?: string
  socrataType: string
  kinds: ColumnKind[]
  /** Numeric data stored as text; must be cast (and null tokens excluded) before aggregating. */
  numericText: boolean
  /** Exact number of distinct values when known. */
  cardinality?: number
  topValues: TopValue[]
  min?: string
  max?: string
  /** Values that are summaries of other rows ("All", "Statewide"); excluded by default. */
  rollupValues: string[]
  /** Placeholder strings meaning "no value" ("NULL", "N<10", "*"). */
  nullTokens: string[]
  /** Hidden from the form (e.g. constant columns). */
  hidden?: boolean
  role: ColumnRole
  /** Aggregations that make sense for this column (empty unless role is 'measure'). */
  aggs: Aggregation[]
  defaultAgg?: Aggregation
  /** Who decided role/aggs: name heuristics, the AI classifier, or the notes file. */
  roleSource: 'heuristic' | 'ai' | 'notes'
}

export interface DatasetProfile {
  id: string
  name: string
  description: string
  rowCount: number
  updatedAt?: string
  columns: ColumnProfile[]
  /** Free-text guidance from the dataset notes file, passed to the AI. */
  notes?: string
  /** Starting filters from the notes file; replaces the automatic rollup exclusions. */
  defaultFilters?: Filter[]
  /** The most useful starting columns, when known (AI classifier or notes). */
  suggested?: { dimension?: string; measure?: string }
}

export interface DatasetSummary {
  id: string
  name: string
  description: string
  category?: string
  updatedAt?: string
}

export interface DistinctValue {
  value: string
  count: number
}

export type Cell = string | number | null

export interface QueryResult {
  /** One row per group. Keys: `dim`, `series` (optional), `m0`, `m1`, ... */
  rows: Record<string, Cell>[]
  /** Number of groups before the top-N cut. */
  totalGroups: number
  /** Number of series before the series cut (when a series column is set). */
  totalSeries?: number
  truncated: boolean
}

export const columnHasKind = (c: ColumnProfile, k: ColumnKind) => c.kinds.includes(k)
