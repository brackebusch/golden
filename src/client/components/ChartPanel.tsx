import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { AlertCircle, BarChart3, Info, Loader2 } from 'lucide-react'
import { describeSpec, filterLabel } from '@shared/describe'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buildChartOption, chartHeight } from '@/lib/chartOptions'
import type { Explorer } from '@/hooks/useExplorer'
import { cn } from '@/lib/utils'

export function ChartPanel({ x, aiEnabled = true }: { x: Explorer; aiEnabled?: boolean }) {
  const run = x.lastRun
  const option = useMemo(() => (run ? buildChartOption(run.profile, run.spec, run.result) : null), [run])
  const height = run ? chartHeight(run.spec, run.result) : undefined

  if (!run && !x.running && !x.runError) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <BarChart3 className="size-10 opacity-40" />
        <div>
          <p className="text-foreground font-medium">No chart yet</p>
          <p className="text-sm">Shape a query on the left{aiEnabled ? ' (or ask below)' : ''}, then click Generate.</p>
        </div>
      </div>
    )
  }

  const empty = run && run.result.rows.length === 0
  const userFilters = run?.spec.filters ?? []

  return (
    <div className="flex h-full flex-col">
      {x.runError && (
        <Alert variant="destructive" className="m-4 w-auto">
          <AlertCircle />
          <AlertTitle>Couldn't load data</AlertTitle>
          <AlertDescription>{x.runError}</AlertDescription>
        </Alert>
      )}

      {run && (
        <div className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{describeSpec(run.profile, run.spec)}</h2>
            <p className="text-muted-foreground truncate text-xs">{run.profile.name}</p>
          </div>
          {run.result.truncated && (
            <Badge variant="outline" className="text-muted-foreground shrink-0 gap-1 font-normal">
              <Info className="size-3" />
              Showing top {Math.min(run.spec.limit, run.result.totalGroups)} of {run.result.totalGroups.toLocaleString()}
              {run.result.totalSeries && run.result.totalSeries > 10 ? ` · top 10 of ${run.result.totalSeries} series` : ''}
            </Badge>
          )}
        </div>
      )}

      <div className={cn('relative min-h-0 flex-1 overflow-y-auto px-2 pb-2 transition-opacity', x.running && 'opacity-40')}>
        {empty ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm">
            <p className="text-foreground font-medium">No rows match this query</p>
            {userFilters.length > 0 && (
              <>
                <p>Try removing one of these filters:</p>
                <div className="flex max-w-lg flex-wrap justify-center gap-1.5">
                  {userFilters.map((f, i) => (
                    <Badge key={i} variant="secondary" className="font-normal">
                      {filterLabel(run.profile, f)}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          option && (
            <ReactECharts
              option={option}
              notMerge
              style={{ height: height ?? '100%', minHeight: 200, width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          )
        )}
      </div>

      {x.running && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      )}
    </div>
  )
}
