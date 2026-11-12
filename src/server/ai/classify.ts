import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ColumnProfile } from '@shared/types'
import { aiEnabled, config } from '../config'
import { getClient } from './client'

/**
 * Asks a small model what each column of a dataset means: whether it's a quantity worth
 * aggregating, an identifier/code, or an ordinal like a year; which aggregations make sense; and
 * which columns make the best starting chart. One call per dataset, saved to
 * .cache/columns/<id>.json and reused until the dataset's columns change.
 */

const VALUE_AGGS = ['sum', 'avg', 'median', 'min', 'max'] as const

const classificationSchema = z.object({
  columns: z.array(
    z.object({
      field: z.string(),
      role: z.enum(['measure', 'identifier', 'ordinal', 'other']),
      aggregations: z.array(z.enum(VALUE_AGGS)),
      default_aggregation: z.enum(VALUE_AGGS).nullable(),
    }),
  ),
  primary_measure: z.string().nullable(),
  primary_dimension: z.string().nullable(),
})
export type Classification = z.infer<typeof classificationSchema>

const SYSTEM = `You classify the columns of a public open-data table so a chart builder only offers sensible choices.

For every column, give:
- role:
  - "measure": a quantity where aggregating across rows means something (counts, amounts, money, earnings, rates, percentages, scores, durations).
  - "identifier": a number that names something rather than measuring it (ids, codes, version numbers, zip/FIPS/CIP/NAICS codes, account/permit/stock numbers, phone numbers, latitude/longitude). Averaging or summing it is nonsense.
  - "ordinal": years, fiscal years, months, quarters, ranks or sequence positions. Useful on an axis, not as a value.
  - "other": text, dates, booleans, and anything that isn't numeric.
- aggregations: for measures only, the aggregations that are meaningful. Use [] for every non-measure.
  - Additive quantities (counts, amounts, money, totals): sum, avg, median, min, max.
  - Rates, percentages, ratios, averages, medians, percentiles, per-capita values, scores: avg, median, min, max. Never sum.
- default_aggregation: the single best aggregation for a measure ("sum" for additive counts/amounts, "avg" for rates and per-unit values), or null for non-measures.

Also pick:
- primary_measure: the measure field most people would want to chart first, or null if there is none.
- primary_dimension: the category or date field most people would want to break that measure down by (readable, roughly 3-50 distinct values preferred), or null.

Use exact field names. Include every column exactly once.`

function describeColumn(c: ColumnProfile) {
  return {
    field: c.fieldName,
    label: c.label,
    type: c.socrataType + (c.numericText ? ' (numbers stored as text)' : ''),
    ...(c.description ? { description: c.description.slice(0, 200) } : {}),
    ...(c.cardinality != null ? { distinct_values: c.cardinality } : {}),
    ...(c.min != null ? { min: c.min, max: c.max } : {}),
    sample_values: c.topValues.slice(0, 6).map((t) => t.value.slice(0, 60)),
  }
}

const CACHE_DIR = path.resolve('.cache', 'columns')
const signature = (columns: ColumnProfile[]) =>
  createHash('sha1')
    .update(config.classifyModel + '|' + columns.map((c) => `${c.fieldName}:${c.socrataType}:${c.label}`).join(','))
    .digest('hex')

export const classifierEnabled = () => aiEnabled() && config.aiClassifyColumns

/** Returns the classification, or null when disabled or the call fails (heuristics stay in place). */
export async function classifyColumns(
  dataset: { id: string; name: string; description: string; rowCount: number },
  columns: ColumnProfile[],
): Promise<Classification | null> {
  if (!classifierEnabled()) return null
  const file = path.join(CACHE_DIR, `${dataset.id}.json`)
  const sig = signature(columns)
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { signature: string; result: Classification }
      if (saved.signature === sig) return saved.result
    } catch {
      /* unreadable: reclassify */
    }
  }

  const started = Date.now()
  try {
    const input = {
      dataset: dataset.name,
      description: dataset.description.slice(0, 800),
      rows: dataset.rowCount,
      columns: columns.map(describeColumn),
    }
    const res = await getClient().messages.parse(
      {
        model: config.classifyModel,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(classificationSchema) },
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      },
      { timeout: 30_000, maxRetries: 1 },
    )
    const result = res.parsed_output
    if (!result) {
      console.warn(`[classify] ${dataset.id}: no parsable output (stop_reason ${res.stop_reason})`)
      return null
    }
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, JSON.stringify({ signature: sig, result }, null, 1))
    console.log(
      `[classify] ${dataset.id}: ${columns.length} columns in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
        `(in ${res.usage.input_tokens}, out ${res.usage.output_tokens} tokens)`,
    )
    return result
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : String(e)
    console.warn(`[classify] ${dataset.id}: failed, using heuristics: ${msg}`)
    return null
  }
}
