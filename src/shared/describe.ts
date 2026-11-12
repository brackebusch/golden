import type { DatasetProfile } from './types'
import { AGG_LABELS, COUNT_ROWS, type Filter, type Measure, type QuerySpec } from './querySpec'

export const columnLabel = (p: DatasetProfile, field: string) =>
  p.columns.find((c) => c.fieldName === field)?.label ?? field

export const measureLabel = (p: DatasetProfile, m: Measure) =>
  m.column === COUNT_ROWS ? 'Number of rows' : `${AGG_LABELS[m.agg]} ${columnLabel(p, m.column).toLowerCase()}`

export function filterLabel(p: DatasetProfile, f: Filter): string {
  const name = columnLabel(p, f.column)
  const list = (v: string[]) => (v.length <= 2 ? v.join(', ') : `${v.slice(0, 2).join(', ')} +${v.length - 2}`)
  switch (f.op) {
    case 'in':
      return `${name}: ${list(f.values)}`
    case 'not_in':
      return `${name} ≠ ${list(f.values)}`
    case 'contains':
      return `${name} contains "${f.value}"`
    case 'range':
      if (f.min != null && f.max != null) return `${name}: ${f.min}–${f.max}`
      if (f.min != null) return `${name} ≥ ${f.min}`
      if (f.max != null) return `${name} ≤ ${f.max}`
      return `${name}: any`
  }
}

/** One-line plain-English description, used as the chart title. */
export function describeSpec(p: DatasetProfile, spec: QuerySpec): string {
  const values = spec.chartType === 'scatter'
    ? `${measureLabel(p, spec.measures[1])} vs ${measureLabel(p, spec.measures[0])}`
    : spec.measures.map((m) => measureLabel(p, m)).join(', ')
  let text = values.charAt(0).toUpperCase() + values.slice(1)
  if (spec.dimension) text += ` ${spec.chartType === 'scatter' ? 'per' : 'by'} ${columnLabel(p, spec.dimension.column).toLowerCase()}`
  if (spec.series) text += `, split by ${columnLabel(p, spec.series).toLowerCase()}`
  return text
}
