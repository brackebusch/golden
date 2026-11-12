import { z } from 'zod'

export const CHART_TYPES = ['bar', 'line', 'scatter', 'pie'] as const
export const AGGREGATIONS = ['count', 'sum', 'avg', 'median', 'min', 'max'] as const
export const TIME_GRAINS = ['year', 'month', 'day'] as const
export const SORTS = ['measure_desc', 'measure_asc', 'dimension_asc', 'dimension_desc'] as const

export const COUNT_ROWS = '*'

export const measureSchema = z.object({
  /** Column fieldName, or "*" for count of rows. */
  column: z.string().min(1),
  agg: z.enum(AGGREGATIONS),
})

export const filterSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('in'),
    column: z.string().min(1),
    values: z.array(z.string()),
  }),
  z.object({
    op: z.literal('not_in'),
    column: z.string().min(1),
    values: z.array(z.string()),
    /** Set when the filter was added automatically to exclude rollup rows. */
    rollup: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('range'),
    column: z.string().min(1),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
  }),
  z.object({
    op: z.literal('contains'),
    column: z.string().min(1),
    value: z.string(),
  }),
])

export const querySpecSchema = z.object({
  datasetId: z.string().min(1),
  chartType: z.enum(CHART_TYPES),
  /** Bar/line: x axis. Pie: slices. Scatter: one point per value. */
  dimension: z
    .object({
      column: z.string().min(1),
      grain: z.enum(TIME_GRAINS).optional(),
    })
    .nullable(),
  /** Bar/line: one or more y values. Pie: one. Scatter: [x, y]. */
  measures: z.array(measureSchema).min(1).max(3),
  /** Optional column that splits the data into colored series. */
  series: z.string().nullable(),
  filters: z.array(filterSchema),
  sort: z.enum(SORTS),
  /** Max number of dimension groups to show (top N). */
  limit: z.number().int().min(1).max(500),
})

export type ChartType = (typeof CHART_TYPES)[number]
export type Aggregation = (typeof AGGREGATIONS)[number]
export type TimeGrain = (typeof TIME_GRAINS)[number]
export type Sort = (typeof SORTS)[number]
export type Measure = z.infer<typeof measureSchema>
export type Filter = z.infer<typeof filterSchema>
export type QuerySpec = z.infer<typeof querySpecSchema>

export const AGG_LABELS: Record<Aggregation, string> = {
  count: 'Count',
  sum: 'Sum',
  avg: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
}

/** Stable string form of a spec, used to detect a stale chart. */
export const specKey = (spec: QuerySpec | null) => (spec ? JSON.stringify(spec) : '')
