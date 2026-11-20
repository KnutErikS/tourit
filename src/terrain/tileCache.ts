/**
 * A cache of promised values with a memory budget in bytes, least recently
 * used out first. A value's size is counted once its promise resolves;
 * pending entries are never evicted (someone is waiting for them), and a
 * rejected promise is dropped so the next call tries again.
 *
 * Pure: no imports, so `node --test` can load it.
 */
export class TileCache<V> {
  private readonly entries = new Map<string, { value: Promise<V>; bytes: number }>();
  private total = 0;
  readonly budget: number;
  private readonly sizeOf: (v: V) => number;

  constructor(budget: number, sizeOf: (v: V) => number) {
    this.budget = budget;
    this.sizeOf = sizeOf;
  }

  /** The value for `key`, marked as just used; undefined if not cached. */
  get(key: string): Promise<V> | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key); // re-insert: Map order is the use order
    this.entries.set(key, e);
    return e.value;
  }

  set(key: string, value: Promise<V>): void {
    this.delete(key);
    const e = { value, bytes: 0 };
    this.entries.set(key, e);
    value.then(
      (v) => {
        if (this.entries.get(key) !== e) return; // replaced or evicted meanwhile
        e.bytes = this.sizeOf(v);
        this.total += e.bytes;
        this.evict(key);
      },
      () => {
        if (this.entries.get(key) === e) this.entries.delete(key);
      },
    );
  }

  delete(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.total -= e.bytes;
    this.entries.delete(key);
  }

  /** Bytes held by resolved entries. */
  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drop least recently used resolved entries until within budget; never `keep` (the one just stored). */
  private evict(keep: string): void {
    for (const [k, e] of this.entries) {
      if (this.total <= this.budget) return;
      if (k === keep || !e.bytes) continue;
      this.total -= e.bytes;
      this.entries.delete(k);
    }
  }
}
