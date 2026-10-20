// A small in-memory stale-while-revalidate cache, the server's version of
// incremental static regeneration: a key is answered from memory while it is
// fresh; once stale it is still answered from memory at once while one
// background load refreshes it. Only used for answers that are the same for
// everybody (the guest view of the catalogue, the sitemap, page metadata),
// never for anything personal.

interface Entry<T> {
  value: T;
  at: number;
  refreshing?: Promise<void>;
}

export class SwrCache<T> {
  private entries = new Map<string, Entry<T>>();

  /**
   * @param ttlMs how long an answer counts as fresh
   * @param maxAgeMs past this a stale answer is not served; the caller waits
   * @param maxEntries oldest keys are dropped beyond this
   */
  constructor(private ttlMs: number, private maxAgeMs = ttlMs * 10, private maxEntries = 500) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    if (hit && now - hit.at < this.maxAgeMs) {
      if (!hit.refreshing) {
        hit.refreshing = load()
          .then((value) => this.set(key, value))
          .catch((err) => { console.warn('cache refresh failed for ' + key + ': ' + (err as Error).message); })
          .finally(() => { hit.refreshing = undefined; });
      }
      return hit.value;
    }
    const value = await load();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  private set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: Date.now() });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}
