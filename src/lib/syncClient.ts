// Client-side driver for the resumable /api/sync endpoint (P6). Each POST does a
// time-bounded slice of the work and returns any `remaining` providers; we
// re-POST those until the server reports `done`, so the full sync completes
// across several short requests instead of one long/OOM-prone one. `onProgress`
// fires after every slice for incremental UI. The guard cap makes a server bug
// (never reporting done) fail closed instead of looping forever.

export interface SyncSliceResult {
  ok: boolean;
  results: { provider: string; wishlist: number; library: number; error?: string }[];
  done: boolean;
  remaining: string[];
}

export async function syncToCompletion(
  provider: string = "all",
  onProgress?: (slice: SyncSliceResult) => void,
): Promise<void> {
  let body: Record<string, unknown> = { provider };
  for (let guard = 0; guard < 25; guard++) {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return; // 401/429/500 — bail; caller keeps whatever synced so far
    const slice = (await res.json()) as SyncSliceResult;
    onProgress?.(slice);
    if (slice.done || !slice.remaining?.length) return;
    body = { providers: slice.remaining };
  }
}
