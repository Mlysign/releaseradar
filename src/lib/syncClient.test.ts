import { describe, it, expect, vi, afterEach } from "vitest";
import { syncToCompletion } from "./syncClient";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(slices: any[]) {
  const calls: any[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    const slice = slices[Math.min(i++, slices.length - 1)];
    return { ok: slice.ok !== false, json: async () => slice } as Response;
  });
  return calls;
}

describe("syncToCompletion", () => {
  it("completes in one call when the server reports done immediately", async () => {
    const calls = stubFetch([{ ok: true, results: [], done: true, remaining: [] }]);
    await syncToCompletion("all");
    expect(calls).toEqual([{ provider: "all" }]);
  });

  it("re-invokes with `remaining` until done, then stops", async () => {
    const calls = stubFetch([
      { ok: true, results: [{ provider: "trakt" }], done: false, remaining: ["rawg", "steam"] },
      { ok: true, results: [{ provider: "rawg" }], done: false, remaining: ["steam"] },
      { ok: true, results: [{ provider: "steam" }], done: true, remaining: [] },
    ]);
    const progress: number[] = [];
    await syncToCompletion("all", (s) => progress.push(s.results.length));
    expect(calls).toEqual([
      { provider: "all" },
      { providers: ["rawg", "steam"] },
      { providers: ["steam"] },
    ]);
    expect(progress).toEqual([1, 1, 1]);
  });

  it("bails out on a non-ok response without looping", async () => {
    const calls = stubFetch([{ ok: false }]);
    await syncToCompletion("all");
    expect(calls).toHaveLength(1);
  });

  it("treats an empty `remaining` as done even if the server omits done", async () => {
    const calls = stubFetch([{ ok: true, results: [], remaining: [] }]);
    await syncToCompletion("all");
    expect(calls).toHaveLength(1);
  });
});
