import type { DatasetProfile, DatasetSummary, DistinctValue, QueryResult } from '@shared/types'
import type { QuerySpec } from '@shared/querySpec'

export interface AppConfig {
  aiEnabled: boolean
  aiAutoRun: boolean
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  datasets: (q: string, signal?: AbortSignal) =>
    request<DatasetSummary[]>(`/api/datasets?q=${encodeURIComponent(q)}`, { signal }),
  profile: (id: string) => request<DatasetProfile>(`/api/datasets/${id}/profile`),
  values: (id: string, column: string, q: string, signal?: AbortSignal) =>
    request<DistinctValue[]>(
      `/api/datasets/${id}/values?column=${encodeURIComponent(column)}&q=${encodeURIComponent(q)}`,
      { signal },
    ),
  query: (spec: QuerySpec) =>
    request<QueryResult>('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    }),
}
