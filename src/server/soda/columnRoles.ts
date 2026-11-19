import type { ColumnProfile, ColumnRole } from '@shared/types'
import { ROLE_AGGS, type Aggregation } from '@shared/querySpec'

/**
 * Name/type heuristics for what a numeric column means. These run for every dataset; when the AI
 * is available, `ai/classify.ts` refines them, and dataset notes files override both.
 *
 * They only decide what the form *suggests*: any numeric column can still be picked with any
 * aggregation in the form (with a warning), so a wrong guess costs a click, not a dead end.
 */

/** Split "OrganizationTTL", "stock_number", "Org ID" into lowercase words. */
const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9#%]+/)
    .filter(Boolean)

const set = (s: string) => new Set(s.split(' '))

/** Words that mark an identifier wherever they appear. */
const STRONG_ID = set(
  'id ids identifier uuid guid objectid fid fips zip zipcode postal phone ubi ein serial version latitude longitude lat lon lng',
)
/** Words that mark an identifier only as the last word of the label ("Parcel", "NAICS Code"), not "Code Violations". */
const WEAK_ID = set('key code account parcel permit license licence cip naics soc sic district precinct sequence seq')
/** Trailing words that make a label an identifier ("Stock Number"), unless it reads "Number of ...". */
const ID_SUFFIXES = set('number num no nbr #')
/** Words that make a column a quantity, which outweighs a weak identifier or period word. */
const MEASURE_WORDS = set(
  'total count counts amount amounts balance spending spent cost costs revenue revenues earnings income sales cases deaths population enrollment students value price prices fee fees salary salaries wage wages pay budget expenditure expenditures expense expenses dollars acres miles tons gallons pounds hours minutes days visits violations incidents claims sum quantity qty volume',
)
const PERIOD_WORDS = set('year years yr fy biennium quarter month week rank ranking')
/** Words that introduce a rate ("per year", "each month") instead of naming the period itself. */
const RATE_PREFIX = set('per each a every this last')
const RATE_WORDS = set(
  'percent percentage pct % rate ratio share average avg mean median per index score proportion probability percentile',
)

/** Whole numbers in a year range with few distinct values: a year column even when it isn't named one. */
function looksLikeYears(c: ColumnProfile) {
  const lo = Number(c.min)
  const hi = Number(c.max)
  return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1900 && hi <= 2100 && c.cardinality != null && c.cardinality <= 60
}

function role(c: ColumnProfile): Exclude<ColumnRole, 'other'> {
  const label = words(c.label)
  const all = words(`${c.label} ${c.fieldName}`)
  const last = label[label.length - 1]

  if (all.some((w) => STRONG_ID.has(w)) || (label.length === 1 && (last === 'x' || last === 'y'))) return 'identifier'
  // A label ending in the period itself ("Fiscal Year", "Enrollment Year") is that period.
  if (last && PERIOD_WORDS.has(last) && !RATE_PREFIX.has(label[label.length - 2])) return 'ordinal'
  if (label.some((w) => MEASURE_WORDS.has(w))) return 'measure'
  if (last && WEAK_ID.has(last)) return 'identifier'
  if (last && ID_SUFFIXES.has(last) && !label.includes('of')) return 'identifier'
  const period = label.findIndex((w) => PERIOD_WORDS.has(w))
  if ((period >= 0 && !RATE_PREFIX.has(label[period - 1])) || looksLikeYears(c)) return 'ordinal'
  return 'measure'
}

export function heuristicRole(c: ColumnProfile): { role: ColumnRole; aggs: Aggregation[]; defaultAgg?: Aggregation } {
  if (!c.kinds.includes('number')) return { role: 'other', aggs: [] }
  const r = role(c)
  if (r !== 'measure') return { role: r, ...ROLE_AGGS[r] }
  const rate = c.socrataType === 'percent' || words(`${c.label} ${c.fieldName}`).some((w) => RATE_WORDS.has(w))
  return { role: 'measure', ...(rate ? ROLE_AGGS.rate : ROLE_AGGS.measure) }
}
