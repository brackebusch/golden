import type { ColumnProfile, ColumnRole } from '@shared/types'
import type { Aggregation } from '@shared/querySpec'

/**
 * Name/type heuristics for what a numeric column means. These run for every dataset; when the AI
 * is available, `ai/classify.ts` refines them, and dataset notes files override both.
 */

export const MEASURE_AGGS: Aggregation[] = ['sum', 'avg', 'median', 'min', 'max']
/** Rates, percentages and averages: summing them is meaningless. */
export const RATE_AGGS: Aggregation[] = ['avg', 'median', 'min', 'max']

/** Split "OrganizationTTL", "stock_number", "Org ID" into lowercase words. */
const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9#%]+/)
    .filter(Boolean)

/** Words that mark an identifier anywhere in the name. */
const ID_WORDS = new Set('id ids identifier key code version zip zipcode postal fips phone ubi ein account parcel permit license licence serial sequence seq objectid fid uuid guid latitude longitude lat lon lng x y cip naics soc sic district precinct'.split(' '))
/** Words that mark an identifier only as the last word ("Stock Number", but not "Number of graduates"). */
const ID_SUFFIXES = new Set(['number', 'num', 'no', 'nbr', '#'])
const ORDINAL_WORDS = new Set(['year', 'yr', 'fy', 'biennium', 'quarter', 'month', 'week', 'rank', 'ranking', 'order'])
const RATE_WORDS = new Set('percent percentage pct % rate ratio share average avg mean median per index score proportion probability percentile'.split(' '))

function isYearRange(c: ColumnProfile) {
  const lo = Number(c.min)
  const hi = Number(c.max)
  return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1900 && hi <= 2100 && lo > 0
}

export function heuristicRole(c: ColumnProfile): { role: ColumnRole; aggs: Aggregation[]; defaultAgg?: Aggregation } {
  if (!c.kinds.includes('number')) return { role: 'other', aggs: [] }
  const w = words(`${c.label} ${c.fieldName}`)
  const labelWords = words(c.label)
  const last = labelWords[labelWords.length - 1]

  if (w.some((x) => ID_WORDS.has(x)) || (last && ID_SUFFIXES.has(last) && !labelWords.includes('of')))
    return { role: 'identifier', aggs: [] }
  if (w.some((x) => ORDINAL_WORDS.has(x)) || isYearRange(c)) return { role: 'ordinal', aggs: [] }

  const rate = c.socrataType === 'percent' || w.some((x) => RATE_WORDS.has(x))
  return rate ? { role: 'measure', aggs: RATE_AGGS, defaultAgg: 'avg' } : { role: 'measure', aggs: MEASURE_AGGS, defaultAgg: 'sum' }
}
