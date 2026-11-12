type Entry<T> = { value: T; expires: number }

/** Tiny in-memory TTL cache with in-flight de-duplication. */
export class TtlCache {
  private store = new Map<string, Entry<unknown>>()
  private inflight = new Map<string, Promise<unknown>>()

  async getOrSet<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key)
    if (hit && hit.expires > Date.now()) return hit.value as T
    const pending = this.inflight.get(key)
    if (pending) return pending as Promise<T>
    const p = load()
      .then((value) => {
        this.store.set(key, { value, expires: Date.now() + ttlMs })
        return value
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}

export const cache = new TtlCache()
