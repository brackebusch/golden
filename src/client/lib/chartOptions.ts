import type { EChartsOption, SeriesOption } from 'echarts'
import type { Cell, DatasetProfile, QueryResult } from '@shared/types'
import type { QuerySpec } from '@shared/querySpec'
import { columnLabel, measureLabel } from '@shared/describe'
import { fmtCompact, fmtFull } from './format'

const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']

const base: EChartsOption = {
  color: PALETTE,
  animationDuration: 300,
  textStyle: { fontFamily: 'inherit' },
  grid: { left: 16, right: 24, top: 40, bottom: 16, containLabel: true },
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Ordered unique values. */
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

/** Build one series per measure (no split) or one per series value (split by a column). */
function pivot(spec: QuerySpec, result: QueryResult, p: DatasetProfile) {
  const dims = uniq(result.rows.map((r) => r.dim))
  if (!spec.series) {
    return {
      dims,
      series: spec.measures.map((m, i) => ({
        name: measureLabel(p, m),
        data: result.rows.map((r) => r[`m${i}`] as number | null),
      })),
    }
  }
  const index = new Map<string, number | null>()
  for (const r of result.rows) index.set(`${r.dim}\u0000${r.series}`, r.m0 as number | null)
  const seriesValues = uniq(result.rows.map((r) => r.series))
  return {
    dims,
    series: seriesValues.map((s) => ({
      name: String(s ?? '(blank)'),
      data: dims.map((d) => index.get(`${d}\u0000${s}`) ?? null),
    })),
  }
}

export function buildChartOption(p: DatasetProfile, spec: QuerySpec, result: QueryResult): EChartsOption {
  const dimName = spec.dimension ? columnLabel(p, spec.dimension.column) : ''
  const showLegend = !!spec.series || spec.measures.length > 1
  const legend = showLegend ? { type: 'scroll' as const, top: 0 } : undefined

  switch (spec.chartType) {
    case 'pie':
      return {
        ...base,
        tooltip: {
          trigger: 'item',
          valueFormatter: fmtFull,
        },
        legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', formatter: (n: string) => truncate(n, 28) },
        series: [
          {
            type: 'pie',
            name: measureLabel(p, spec.measures[0]),
            radius: ['35%', '70%'],
            center: ['40%', '50%'],
            itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
            label: { formatter: '{d}%' },
            data: result.rows.map((r) => ({ name: String(r.dim ?? '(blank)'), value: r.m0 as number })),
          },
        ],
      }

    case 'scatter': {
      const groups = new Map<Cell, (number | string | null)[][]>()
      for (const r of result.rows) {
        const key = spec.series ? r.series : measureLabel(p, spec.measures[1])
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push([r.m0 as number, r.m1 as number, String(r.dim)])
      }
      const xName = measureLabel(p, spec.measures[0])
      const yName = measureLabel(p, spec.measures[1])
      return {
        ...base,
        legend: spec.series ? legend : undefined,
        grid: { ...base.grid, top: spec.series ? 40 : 24, bottom: 32, left: 24 },
        tooltip: {
          trigger: 'item',
          formatter: (params: unknown) => {
            const { data, seriesName } = params as { data: [number, number, string]; seriesName: string }
            return `<b>${data[2]}</b>${spec.series ? `<br/>${seriesName}` : ''}<br/>${xName}: ${fmtFull(data[0])}<br/>${yName}: ${fmtFull(data[1])}`
          },
        },
        xAxis: { type: 'value', name: xName, nameLocation: 'middle', nameGap: 28, scale: true, axisLabel: { formatter: fmtCompact } },
        yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 48, scale: true, axisLabel: { formatter: fmtCompact } },
        series: [...groups.entries()].map(([name, data]) => ({
          type: 'scatter',
          name: String(name ?? '(blank)'),
          data,
          symbolSize: 9,
          emphasis: { focus: 'series' },
        })),
      }
    }

    case 'line': {
      const { dims, series } = pivot(spec, result, p)
      return {
        ...base,
        legend,
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, valueFormatter: fmtFull, order: 'valueDesc' },
        xAxis: { type: 'category', name: dimName, nameLocation: 'middle', nameGap: 28, boundaryGap: false, data: dims.map(String) },
        yAxis: { type: 'value', scale: true, axisLabel: { formatter: fmtCompact } },
        grid: { ...base.grid, bottom: 32 },
        series: series.map(
          (s): SeriesOption => ({ type: 'line', name: s.name, data: s.data, showSymbol: dims.length <= 40, connectNulls: true, emphasis: { focus: 'series' } }),
        ),
      }
    }

    case 'bar': {
      const { dims, series } = pivot(spec, result, p)
      const labels = dims.map((d) => String(d ?? '(blank)'))
      const horizontal = isHorizontal(labels)
      const categoryAxis = {
        type: 'category' as const,
        data: labels,
        inverse: horizontal,
        axisLabel: { formatter: (v: string) => truncate(v, horizontal ? 34 : 14), interval: 0, rotate: horizontal ? 0 : labels.length > 6 ? 30 : 0 },
        axisTick: { show: false },
      }
      const valueAxis = { type: 'value' as const, axisLabel: { formatter: fmtCompact } }
      return {
        ...base,
        legend,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: fmtFull },
        xAxis: horizontal ? valueAxis : categoryAxis,
        yAxis: horizontal ? categoryAxis : valueAxis,
        series: series.map(
          (s): SeriesOption => ({ type: 'bar', name: s.name, data: s.data, barMaxWidth: 36, itemStyle: { borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] }, emphasis: { focus: 'series' } }),
        ),
      }
    }
  }
}

/** Long category names (or many of them) read better as horizontal bars, top item first. */
function isHorizontal(labels: string[]) {
  const avgLen = labels.reduce((n, l) => n + l.length, 0) / Math.max(labels.length, 1)
  return avgLen > 10 || labels.length > 12
}

/** Pixel height for the chart; horizontal bar charts grow with the number of bars. */
export function chartHeight(spec: QuerySpec, result: QueryResult) {
  if (spec.chartType !== 'bar') return undefined
  const labels = uniq(result.rows.map((r) => String(r.dim ?? '(blank)')))
  if (!isHorizontal(labels)) return undefined
  const dims = labels.length
  const seriesCount = spec.series ? new Set(result.rows.map((r) => r.series)).size : spec.measures.length
  return Math.max(320, dims * Math.min(22 * seriesCount, 60) + 80)
}
