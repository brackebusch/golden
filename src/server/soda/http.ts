import { config } from '../config'

export class SodaError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const socrataAuth =
  config.socrataKeyId && config.socrataKeySecret
    ? `Basic ${Buffer.from(`${config.socrataKeyId}:${config.socrataKeySecret}`).toString('base64')}`
    : undefined

/** GET JSON from Socrata. Sends the API key (HTTP Basic auth) to the data domain when configured. */
export async function sodaGet<T>(url: string, params?: Record<string, string>, timeoutMs = 30_000): Promise<T> {
  const u = new URL(url)
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (socrataAuth && u.hostname === config.socrataDomain) headers.Authorization = socrataAuth

  let res: Response
  try {
    res = await fetch(u, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    throw new SodaError(timedOut ? 'data.wa.gov took too long to respond. Try again, or narrow the query with filters.' : 'Could not reach data.wa.gov.', timedOut ? 504 : 502)
  }
  if (res.ok) return (await res.json()) as T

  let detail = ''
  try {
    const body = (await res.json()) as { message?: string }
    detail = body.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 429)
    throw new SodaError(
      'data.wa.gov is rate limiting requests. Wait a moment, or add SOCRATA_API_KEY / SOCRATA_API_SECRET to .env.',
      429,
    )
  if (res.status === 401 || res.status === 403)
    console.error('[soda] auth rejected: check SOCRATA_API_KEY / SOCRATA_API_SECRET in .env')
  console.error(`[soda] ${res.status} ${u.toString()}\n  ${detail}`)
  throw new SodaError(detail || `data.wa.gov returned ${res.status}`, res.status)
}

export const resourceUrl = (id: string) => `https://${config.socrataDomain}/resource/${id}.json`
export const viewUrl = (id: string) => `https://${config.socrataDomain}/api/views/${id}.json`

/** Quote a string literal for SoQL. */
export const lit = (s: string) => `'${s.replaceAll("'", "''")}'`
