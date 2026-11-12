import { createContext, useContext, type ReactNode } from 'react'
import { AlertTriangle, Loader2, Play, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { aggsFor, CHART_LIST, CHARTS, checkCompatibility, columnsFor, measureColumns, measureFor } from '@shared/charts'
import { AGG_LABELS, COUNT_ROWS, TIME_GRAINS, type ChartType, type Measure, type Sort } from '@shared/querySpec'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Explorer } from '@/hooks/useExplorer'
import { DatasetPicker } from './DatasetPicker'
import { FilterSection } from './FilterSection'
import { Reveal, RevealList } from './Reveal'

const NONE = '__none__'

const SORT_LABELS: Record<Sort, string> = {
  measure_desc: 'Highest value first',
  measure_asc: 'Lowest value first',
  dimension_asc: 'A → Z / oldest first',
  dimension_desc: 'Z → A / newest first',
}

/** Changes on every AI fill so the fade animation replays. */
const FadeKey = createContext(0)

function Field({ label, hint, highlighted, children }: { label: string; hint?: string; highlighted?: boolean; children: ReactNode }) {
  const fadeKey = useContext(FadeKey)
  return (
    <div className={cn('relative isolate space-y-1.5 rounded-md', highlighted && 'ring-ai -mx-1.5 px-1.5 py-1.5 ring-1')}>
      {highlighted && <div key={fadeKey} aria-hidden className="ai-fade absolute inset-0 -z-10 rounded-md" />}
      <Label className="text-muted-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
        {label}
        {highlighted && (
          <span
            className="text-ai inline-flex items-center gap-0.5 normal-case tracking-normal"
            title="Filled in by Claude; edit it to clear this mark"
          >
            <Sparkles className="size-3" /> AI
          </span>
        )}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

export function QueryForm({ x }: { x: Explorer }) {
  const { profile, spec, chartType, compatibility, highlight } = x
  const hiddenCount = profile?.columns.filter((c) => c.hidden).length ?? 0
  const chart = CHARTS[chartType]
  // While a dataset loads, the current form describes the old dataset: replace it with a skeleton.
  const loading = x.profileLoading
  const blocked = !loading && !!compatibility && !compatibility.ok
  const canGenerate = !!spec && x.errors.length === 0 && !x.running && !loading
  const current = x.hasRun && !x.stale && !x.runError
  // Bar/line can split by a column or show several values, not both.
  const seriesBlockedByMeasures = !!chart.series && !!spec && spec.measures.length > 1 && chart.type !== 'scatter'

  const setMeasure = (i: number, m: Measure) => spec && x.updateSpec({ measures: spec.measures.map((v, j) => (j === i ? m : v)) })

  return (
    <FadeKey.Provider value={x.highlightVersion}>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          <Field label="Dataset" highlighted={highlight.has('datasetId')}>
            <DatasetPicker
              value={profile ? { id: profile.id, name: profile.name } : null}
              loading={x.profileLoading}
              onSelect={(id) => void x.loadDataset(id)}
            />
            {x.profileError && <p className="text-destructive text-xs">{x.profileError}</p>}
            {loading ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" /> Loading columns…
              </p>
            ) : (
              profile && (
                <p className="text-muted-foreground text-xs">
                  {profile.rowCount.toLocaleString()} rows · {profile.columns.length} columns
                  {hiddenCount > 0 && (
                    <span
                      title={`Hidden because every row has the same value: ${profile.columns
                        .filter((c) => c.hidden)
                        .map((c) => c.label)
                        .join(', ')}`}
                    >
                      {' '}
                      ({hiddenCount} hidden)
                    </span>
                  )}
                </p>
              )
            )}
          </Field>

          <div className="pt-5">
            <Field label="Chart type" hint={chart.description} highlighted={highlight.has('chartType')}>
              <Select value={chartType} onValueChange={(v) => x.setChartType(v as ChartType)} disabled={!profile || loading}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_LIST.map((c) => {
                    const ok = profile ? checkCompatibility(profile, c.type).ok : true
                    return (
                      <SelectItem key={c.type} value={c.type} className={cn(!ok && 'text-muted-foreground')}>
                        {c.label}
                        {!ok && ' — not compatible with this dataset'}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Reveal show={blocked} className="pt-5">
            <Alert className="border-warning/50 bg-warning/10">
              <AlertTriangle className="text-warning" />
              <AlertTitle>Chart type and dataset aren't compatible</AlertTitle>
              <AlertDescription>{compatibility?.reason} Choose a different chart type or dataset to continue.</AlertDescription>
            </Alert>
          </Reveal>

          <Reveal show={loading} className="space-y-5 pt-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9" />
              </div>
            ))}
          </Reveal>

          <Reveal show={!!profile && !loading}>
            {profile && (
              <fieldset
                disabled={blocked || !spec}
                className={cn('transition-opacity', (blocked || !spec) && 'pointer-events-none opacity-40')}
              >
                <div className="pt-5">
                  <Field label={chart.dimension.label} hint={chart.dimension.help} highlighted={highlight.has('dimension')}>
                    <Select
                      value={spec?.dimension?.column ?? ''}
                      onValueChange={(column) => {
                        const c = profile.columns.find((v) => v.fieldName === column)
                        x.updateSpec({
                          dimension: {
                            column,
                            ...(c?.kinds.includes('time') ? { grain: 'year' as const } : {}),
                          },
                        })
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columnsFor(profile, chart.dimension.accepts).map((c) => (
                          <SelectItem key={c.fieldName} value={c.fieldName}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Reveal show={!!spec?.dimension?.grain}>
                      {spec?.dimension?.grain && (
                        <Select
                          value={spec.dimension.grain}
                          onValueChange={(g) =>
                            x.updateSpec({
                              dimension: {
                                ...spec.dimension!,
                                grain: g as 'year',
                              },
                            })
                          }
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_GRAINS.map((g) => (
                              <SelectItem key={g} value={g}>
                                By {g}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Reveal>
                  </Field>
                </div>

                <div className="pt-5">
                  <Field
                    label={chart.measures.max > 1 && chart.measures.min === 1 ? 'Values' : 'Value'}
                    highlighted={highlight.has('measures')}
                  >
                    <RevealList
                      className="pb-1.5 last:pb-0"
                      items={(spec?.measures ?? []).map((m, i) => ({
                        key: `m${i}`,
                        node: (
                          <div className="space-y-1">
                            {chart.measures.min > 1 && <span className="text-muted-foreground text-xs">{chart.measures.labels[i]}</span>}
                            <div className="flex gap-1.5">
                              {aggsFor(profile, m.column).length > 1 && (
                                <Select
                                  value={m.agg}
                                  onValueChange={(agg) =>
                                    setMeasure(i, {
                                      ...m,
                                      agg: agg as Measure['agg'],
                                    })
                                  }
                                >
                                  <SelectTrigger className="w-[104px] shrink-0">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {aggsFor(profile, m.column).map((a) => (
                                      <SelectItem key={a} value={a}>
                                        {AGG_LABELS[a]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <Select value={m.column} onValueChange={(column) => setMeasure(i, measureFor(profile, column, m.agg))}>
                                <SelectTrigger className="min-w-0 flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={COUNT_ROWS}>Number of rows</SelectItem>
                                  {measureColumns(profile).map((c) => (
                                    <SelectItem key={c.fieldName} value={c.fieldName}>
                                      {c.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {spec!.measures.length > chart.measures.min && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  aria-label="Remove value"
                                  onClick={() =>
                                    x.updateSpec({
                                      measures: spec!.measures.filter((_, j) => j !== i),
                                    })
                                  }
                                >
                                  <X className="size-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ),
                      }))}
                    />
                    <Reveal show={!!spec && spec.measures.length < chart.measures.max && !spec.series}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() =>
                          x.updateSpec({
                            measures: [...spec!.measures, { column: COUNT_ROWS, agg: 'count' }],
                          })
                        }
                      >
                        <Plus className="size-3.5" /> Add value
                      </Button>
                    </Reveal>
                    <Reveal show={seriesBlockedByMeasures}>
                      <p className="text-muted-foreground text-xs">Use a single value to split by a column.</p>
                    </Reveal>
                  </Field>
                </div>

                <Reveal show={!!chart.series && !seriesBlockedByMeasures} className="pt-5">
                  {chart.series && (
                    <Field label={chart.series.label} highlighted={highlight.has('series')}>
                      <Select value={spec?.series ?? NONE} onValueChange={(v) => x.updateSpec({ series: v === NONE ? null : v })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>None</SelectItem>
                          {columnsFor(profile, chart.series.accepts)
                            .filter((c) => c.fieldName !== spec?.dimension?.column)
                            .map((c) => (
                              <SelectItem key={c.fieldName} value={c.fieldName}>
                                {c.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </Reveal>

                <div className="pt-5">
                  <Field label="Filters" highlighted={highlight.has('filters')}>
                    {spec && <FilterSection profile={profile} filters={spec.filters} onChange={(filters) => x.updateSpec({ filters })} />}
                  </Field>
                </div>

                <div className={cn('grid gap-2 pt-5', chart.sorts.length > 1 ? 'grid-cols-[1fr_88px]' : 'grid-cols-[88px]')}>
                  {chart.sorts.length > 1 && (
                    <Field label="Sort" highlighted={highlight.has('sort')}>
                      <Select value={spec?.sort ?? chart.defaultSort} onValueChange={(v) => x.updateSpec({ sort: v as Sort })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {chart.sorts.map((s) => (
                            <SelectItem key={s} value={s}>
                              {SORT_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field label="Show top" highlighted={highlight.has('limit')}>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={spec?.limit ?? chart.defaultLimit}
                      onChange={(e) =>
                        x.updateSpec({
                          limit: Math.min(500, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </Field>
                </div>
              </fieldset>
            )}
          </Reveal>
        </div>

        <div className="space-y-2 p-4">
          {spec && x.errors.length > 0 && !blocked && !loading && (
            <ul className="text-destructive space-y-0.5 text-xs">
              {x.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {x.stale && !x.running && !loading && (
            <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs">
              <RefreshCw className="text-warning mt-0.5 size-3.5 shrink-0" />
              <span>
                The form has changed since this chart was generated. Click <b>Generate</b> to update it.
              </span>
            </div>
          )}
          <Button
            className={cn(
              'w-full',
              current ? 'border-success/40 text-success hover:text-success' : 'bg-success hover:bg-success-hover text-white',
            )}
            variant={current ? 'outline' : 'default'}
            disabled={!canGenerate || blocked}
            onClick={() => void x.generate()}
          >
            {x.running ? <Loader2 className="animate-spin" /> : <Play />}
            {x.running ? 'Generating…' : current ? 'Up to date' : 'Generate'}
          </Button>
        </div>
      </div>
    </FadeKey.Provider>
  )
}
