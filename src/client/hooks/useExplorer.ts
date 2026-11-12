import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DatasetProfile, QueryResult } from '@shared/types'
import { specKey, type ChartType, type QuerySpec } from '@shared/querySpec'
import { checkCompatibility, reconcileSpec, validateSpec } from '@shared/charts'
import { api } from '@/lib/api'

export const DEFAULT_DATASET_ID = 'gmgy-gm47'

export interface RunSnapshot {
  spec: QuerySpec
  profile: DatasetProfile
  result: QueryResult
}

/** Top-level fields of a spec that differ between two specs (for highlighting AI edits). */
export function changedFields(a: QuerySpec | null, b: QuerySpec): Set<string> {
  const keys = ['datasetId', 'chartType', 'dimension', 'measures', 'series', 'filters', 'sort', 'limit'] as const
  return new Set(keys.filter((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b[k] ?? null)))
}

export function useExplorer() {
  const [profile, setProfile] = useState<DatasetProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [chartType, setChartTypeState] = useState<ChartType>('bar')
  const [spec, setSpec] = useState<QuerySpec | null>(null)
  /** Last valid spec, so switching to an incompatible chart and back restores the form. */
  const lastValidSpec = useRef<QuerySpec | null>(null)

  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null)
  /** Spec of the last *attempted* run; staleness is measured against this, not the last render. */
  const [lastRunKey, setLastRunKey] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  /** Fields the AI filled in; outlined until the user changes them. */
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  /** Bumped on every AI fill so the fade animation replays. */
  const [highlightVersion, setHighlightVersion] = useState(0)

  useEffect(() => {
    if (spec) lastValidSpec.current = spec
  }, [spec])

  const loadDataset = useCallback(
    async (id: string, nextChartType?: ChartType): Promise<DatasetProfile | null> => {
      setProfileLoading(true)
      setProfileError(null)
      try {
        const p = await api.profile(id)
        const type = nextChartType ?? chartType
        setProfile(p)
        setSpec(checkCompatibility(p, type).ok ? reconcileSpec(p, null, type) : null)
        setHighlight(new Set())
        return p
      } catch (e) {
        setProfileError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setProfileLoading(false)
      }
    },
    [chartType],
  )

  // Start with the test dataset selected.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void loadDataset(DEFAULT_DATASET_ID)
  }, [loadDataset])

  const setChartType = useCallback(
    (type: ChartType) => {
      setChartTypeState(type)
      setHighlight((h) => {
        if (!h.has('chartType')) return h
        const next = new Set(h)
        next.delete('chartType')
        return next
      })
      if (!profile) return
      setSpec(checkCompatibility(profile, type).ok ? reconcileSpec(profile, lastValidSpec.current, type) : null)
    },
    [profile],
  )

  const updateSpec = useCallback((patch: Partial<QuerySpec>) => {
    setSpec((s) => (s ? { ...s, ...patch } : s))
    setHighlight((h) => {
      if (h.size === 0) return h
      const next = new Set(h)
      Object.keys(patch).forEach((k) => next.delete(k))
      return next
    })
  }, [])

  const compatibility = useMemo(() => (profile ? checkCompatibility(profile, chartType) : null), [profile, chartType])
  const errors = useMemo(() => (profile && spec ? validateSpec(profile, spec) : []), [profile, spec])
  const stale = lastRunKey !== '' && specKey(spec) !== lastRunKey

  const generate = useCallback(
    async (target: QuerySpec | null = spec, targetProfile: DatasetProfile | null = profile) => {
      if (!target || !targetProfile || validateSpec(targetProfile, target).length) return
      setRunning(true)
      setRunError(null)
      setLastRunKey(specKey(target))
      try {
        const result = await api.query(target)
        setLastRun({ spec: target, profile: targetProfile, result })
      } catch (e) {
        setRunError(e instanceof Error ? e.message : String(e))
      } finally {
        setRunning(false)
      }
    },
    [spec, profile],
  )

  /** Replace the form with a spec (from the AI). Highlights what changed; optionally runs it. */
  const applySpec = useCallback(
    async (next: QuerySpec, opts: { run?: boolean } = {}) => {
      let p = profile
      if (!p || p.id !== next.datasetId) p = await loadDataset(next.datasetId, next.chartType)
      if (!p) return
      setHighlight(changedFields(spec, next))
      setHighlightVersion((v) => v + 1)
      setChartTypeState(next.chartType)
      setSpec(next)
      if (opts.run) await generate(next, p)
    },
    [profile, spec, loadDataset, generate],
  )

  return {
    profile,
    profileLoading,
    profileError,
    chartType,
    spec,
    compatibility,
    errors,
    lastRun,
    running,
    runError,
    stale,
    hasRun: lastRunKey !== '',
    highlight,
    highlightVersion,
    loadDataset,
    setChartType,
    updateSpec,
    generate,
    applySpec,
  }
}

export type Explorer = ReturnType<typeof useExplorer>
