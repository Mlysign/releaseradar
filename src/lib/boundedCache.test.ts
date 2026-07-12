import { describe, it, expect, vi, afterEach } from "vitest";
import { BoundedCache } from "./boundedCache";

// P2: the module caches must not grow without bound. These lock the two
// guarantees the app relies on — a hard size cap with LRU eviction, and lazy
// TTL expiry — plus the null-sentinel semantics the id caches depend on.

describe("BoundedCache — size cap + LRU", () => {
  it("evicts the least-recently-used entry once over `max`", () => {
    const c = new BoundedCache<string, number>({ max: 3 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a"); // touch a → b is now the least-recent
    c.set("d", 4); // overflow → evict b
    expect(c.size).toBe(3);
    expect(c.has("b")).toBe(false);
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.get("d")).toBe(4);
  });

  it("re-setting an existing key updates the value without growing", () => {
    const c = new BoundedCache<string, number>({ max: 2 });
    c.set("a", 1);
    c.set("a", 9);
    expect(c.size).toBe(1);
    expect(c.get("a")).toBe(9);
  });

  it("never exceeds `max` no matter how many distinct keys are written", () => {
    const c = new BoundedCache<number, number>({ max: 10 });
    for (let i = 0; i < 1000; i++) c.set(i, i);
    expect(c.size).toBe(10);
  });

  it("distinguishes a cached null from an absent key (id-cache sentinel)", () => {
    const c = new BoundedCache<string, number | null>({ max: 5 });
    c.set("miss", null);
    expect(c.has("miss")).toBe(true);
    expect(c.get("miss")).toBeNull();
    expect(c.has("never")).toBe(false);
    expect(c.get("never")).toBeUndefined();
  });
});

describe("BoundedCache — TTL", () => {
  afterEach(() => vi.useRealTimers());

  it("treats entries older than ttlMs as absent and drops them lazily", () => {
    vi.useFakeTimers();
    const c = new BoundedCache<string, number>({ max: 5, ttlMs: 1000 });
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(c.has("a")).toBe(false);
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0); // dropped on access, not lingering
  });

  it("no ttlMs → entries never expire on age", () => {
    vi.useFakeTimers();
    const c = new BoundedCache<string, number>({ max: 5 });
    c.set("a", 1);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(c.get("a")).toBe(1);
  });
});
