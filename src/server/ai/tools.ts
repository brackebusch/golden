import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { CHART_LIST, checkCompatibility, rollupFilters, validateSpec } from '@shared/charts'
import { querySpecSchema, type QuerySpec } from '@shared/querySpec'
import { describeSpec } from '@shared/describe'
import type { DatasetProfile } from '@shared/types'
import { config } from '../config'
import { searchDatasetsWithColumns } from '../soda/catalog'
import { getProfile } from '../soda/profile'
import { distinctValues, findMissingValues, runQuery } from '../soda/compile'

const DATASET_ID = z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/, 'Dataset ids look like "abcd-1234"')

const specJsonSchema = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(querySpecSchema) as Record<string, unknown>
  return schema
})()

const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_dataset_schema',
    description:
      "Get a dataset's columns (fieldName, label, what each can be used for, sample values, ranges), its notes about rollup rows and double counting, its default filters, and which chart types it supports with each chart's slots. Call this before building a query on a dataset.",
    input_schema: {
      type: 'object',
      properties: { dataset_id: { type: 'string', description: 'Socrata dataset id, e.g. "gmgy-gm47"' } },
      required: ['dataset_id'],
    },
  },
  {
    name: 'search_values',
    description:
      'Find the exact values present in a column, with row counts, optionally filtered by a case-insensitive substring. Use it to resolve names the user mentions (e.g. "UW") to exact values before filtering on them.',
    input_schema: {
      type: 'object',
      properties: {
        dataset_id: { type: 'string' },
        column: { type: 'string', description: 'Column fieldName' },
        query: { type: 'string', description: 'Substring to match; omit to list the most common values' },
      },
      required: ['dataset_id', 'column'],
    },
  },
  {
    name: 'search_datasets',
    description: 'Search data.wa.gov for datasets by keyword. Matches dataset names, descriptions, tags and column names. Returns ids, names, descriptions and column names.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'ask_user',
    description:
      'Ask the user one clarifying question with 2-5 short answer options shown as buttons (they can also type their own answer). Use only when the answer changes the query. Call it on its own, then wait: your turn ends and the answer comes back as this tool\'s result.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'set_query',
    description:
      'Fill in the query form with a complete query spec. The spec is validated against the dataset; errors come back so you can fix them. "summary" is one plain-English sentence describing what the chart will show.',
    input_schema: {
      type: 'object',
      properties: {
        spec: specJsonSchema as Anthropic.Beta.BetaTool['input_schema'],
        summary: { type: 'string' },
      },
      required: ['spec', 'summary'],
    },
  },
]

/** Tool inputs stream as they're generated; every input is validated with zod before use. */
export const TOOLS: Anthropic.Beta.BetaTool[] = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }))

const inputs = {
  get_dataset_schema: z.object({ dataset_id: DATASET_ID }),
  search_values: z.object({ dataset_id: DATASET_ID, column: z.string(), query: z.string().optional() }),
  search_datasets: z.object({ query: z.string() }),
  ask_user: z.object({ question: z.string().min(1), options: z.array(z.string()).min(1).max(6) }),
  set_query: z.object({ spec: z.unknown(), summary: z.string() }),
}
export type ToolName = keyof typeof inputs
export const isToolName = (n: string): n is ToolName => n in inputs

export function parseToolInput<N extends ToolName>(name: N, input: unknown) {
  return inputs[name].safeParse(input) as z.ZodSafeParseResult<z.infer<(typeof inputs)[N]>>
}

/** A short "what I'm doing" line shown in the chat while a tool runs. */
export function toolStatus(name: ToolName, input: Record<string, unknown>): string {
  switch (name) {
    case 'get_dataset_schema':
      return "Reading the dataset's columns…"
    case 'search_values':
      return input.query ? `Looking up "${input.query}" in ${input.column}…` : `Listing values of ${input.column}…`
    case 'search_datasets':
      return `Searching datasets for "${input.query}"…`
    case 'ask_user':
      return 'Asking a question…'
    case 'set_query':
      return 'Filling in the form…'
  }
}

function schemaForAI(p: DatasetProfile) {
  return {
    id: p.id,
    name: p.name,
    description: p.description.slice(0, 600),
    rowCount: p.rowCount,
    notes: p.notes ?? null,
    ...(p.suggested ? { suggestedStart: p.suggested } : {}),
    columns: p.columns
      .filter((c) => !c.hidden)
      .map((c) => ({
        fieldName: c.fieldName,
        label: c.label,
        ...(c.description ? { description: c.description } : {}),
        usableAs: c.kinds,
        role: c.role,
        ...(c.role === 'measure' ? { aggregations: c.aggs, defaultAggregation: c.defaultAgg } : {}),
        ...(c.cardinality != null ? { distinctValues: c.cardinality } : {}),
        sampleValues: c.topValues.slice(0, 10).map((t) => t.value),
        ...(c.min != null && c.kinds.includes('number') ? { min: c.min, max: c.max } : {}),
        ...(c.rollupValues.length ? { rollupValues: c.rollupValues } : {}),
      })),
    defaultFilters: rollupFilters(p),
    chartTypes: Object.fromEntries(
      CHART_LIST.map((chart) => {
        const compat = checkCompatibility(p, chart.type)
        return [
          chart.type,
          compat.ok
            ? {
                dimension: `${chart.dimension.label}: one column usable as ${chart.dimension.accepts.join(' or ')}`,
                measures: `${chart.measures.min === chart.measures.max ? chart.measures.min : `${chart.measures.min}-${chart.measures.max}`} (${chart.measures.labels.slice(0, chart.measures.max).join(', ')}); column "*" with agg "count" counts rows; other columns must have role "measure" and use one of their listed aggregations (never aggregate identifiers or years)`,
                series: chart.series ? `optional column usable as ${chart.series.accepts.join(' or ')}; only one measure allowed when set (except scatter)` : 'not supported',
                sorts: chart.sorts,
              }
            : { compatible: false, reason: compat.reason },
        ]
      }),
    ),
  }
}

export interface ToolContext {
  /** Called when set_query succeeds, so the client can fill in the form. */
  onSpec: (spec: QuerySpec, summary: string) => void
}

/** Run a tool. Returns the text result for Claude, and whether it's an error. */
export async function runTool(
  name: Exclude<ToolName, 'ask_user'>,
  input: unknown,
  ctx: ToolContext,
): Promise<{ content: string; isError?: boolean }> {
  switch (name) {
    case 'get_dataset_schema': {
      const { dataset_id } = inputs.get_dataset_schema.parse(input)
      return { content: JSON.stringify(schemaForAI(await getProfile(dataset_id))) }
    }
    case 'search_values': {
      const { dataset_id, column, query } = inputs.search_values.parse(input)
      const p = await getProfile(dataset_id)
      if (!p.columns.some((c) => c.fieldName === column))
        return { isError: true, content: `Unknown column "${column}". Columns: ${p.columns.map((c) => c.fieldName).join(', ')}` }
      const values = await distinctValues(p, column, query ?? '', 25)
      return { content: JSON.stringify(values.length ? values : `No values of ${column} contain "${query}".`) }
    }
    case 'search_datasets': {
      const { query } = inputs.search_datasets.parse(input)
      const results = await searchDatasetsWithColumns(query)
      return {
        content: JSON.stringify(
          results.slice(0, 10).map((d) => ({
            id: d.id,
            name: d.name,
            category: d.category,
            description: d.description.slice(0, 200),
            columns: d.columns.slice(0, 40),
          })),
        ),
      }
    }
    case 'set_query': {
      const { spec: raw, summary } = inputs.set_query.parse(input)
      const parsed = querySpecSchema.safeParse(raw)
      if (!parsed.success)
        return { isError: true, content: `Invalid spec:\n${parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}` }
      const spec = parsed.data
      const p = await getProfile(spec.datasetId)
      const errors = validateSpec(p, spec)
      for (const f of spec.filters) {
        if ((f.op === 'in' || f.op === 'not_in') && !(f.op === 'not_in' && f.rollup)) {
          const missing = await findMissingValues(p, f.column, f.values)
          if (missing.length)
            errors.push(`Filter on ${f.column}: these values don't exist: ${missing.map((m) => JSON.stringify(m)).join(', ')}. Use search_values to find exact spellings.`)
        }
      }
      if (errors.length) return { isError: true, content: `The spec has problems:\n${errors.map((e) => `- ${e}`).join('\n')}` }

      ctx.onSpec(spec, summary)
      if (!config.aiAutoRun)
        return {
          content: `Form filled in ("${describeSpec(p, spec)}"). The user will review it and click Generate; you haven't seen the results, so don't describe them.`,
        }
      const result = await runQuery(p, spec)
      return {
        content: JSON.stringify({
          status: 'Form filled in and chart generated.',
          totalGroups: result.totalGroups,
          truncated: result.truncated,
          firstRows: result.rows.slice(0, 15),
          note: 'Row keys: dim = dimension, series = series, m0/m1/... = measures in order.',
        }),
      }
    }
  }
}
