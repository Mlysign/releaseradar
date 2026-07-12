// A tiny dependency-free bounded cache: LRU eviction by entry count, plus an
// optional per-entry TTL. Built for the app's single long-lived Node process
// (P1 = single-instance) where module-level `Map` caches would otherwise grow
// without bound (P2). Map-like API (`has`/`get`/`set`/`delete`/`clear`/`keys`/
// `size`) so existing call sites change minimally.
//
//   - `max`   — hard cap on live entries; on overflow the least-recently-used
//               entry is evicted. `get()` counts as a use (LRU touch); `has()`
//               does not reorder.
//   - `ttlMs` — optional; an entry older than this is treated as absent and
//               dropped lazily on the next `has()`/`get()`.
//
// Not thread-safe by design: JS's single-threaded execution makes the
// `has()`→`get()` sequences in callers safe without locking.
export class BoundedCache<K, V> {
  private m = new Map<K, { v: V; at: number }>();
  private readonly max: number;
  private readonly ttlMs?: number;

  constructor(opts: { max: number; ttlMs?: number }) {
    this.max = Math.max(1, opts.max);
    this.ttlMs = opts.ttlMs;
  }

  private fresh(e: { at: number }): boolean {
    return this.ttlMs === undefined || Date.now() - e.at < this.ttlMs;
  }

  has(key: K): boolean {
    const e = this.m.get(key);
    if (!e) return false;
    if (!this.fresh(e)) {
      this.m.delete(key);
      return false;
    }
    return true;
  }

  get(key: K): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (!this.fresh(e)) {
      this.m.delete(key);
      return undefined;
    }
    // LRU touch: reinsert so this key becomes the most-recently-used.
    this.m.delete(key);
    this.m.set(key, e);
    return e.v;
  }

  set(key: K, value: V): void {
    this.m.delete(key); // reinsert at the most-recent position
    this.m.set(key, { v: value, at: Date.now() });
    if (this.m.size > this.max) {
      // Map preserves insertion order → the first key is the least-recent.
      const oldest = this.m.keys().next().value as K | undefined;
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.m.delete(key);
  }

  clear(): void {
    this.m.clear();
  }

  keys(): IterableIterator<K> {
    return this.m.keys();
  }

  get size(): number {
    return this.m.size;
  }
}
