import { randomUUID } from "crypto";
import { query, run } from "@/lib/db";
import { MediaSource } from "@/lib/sources/types";
import { SOURCES, getSource } from "@/lib/sources/registry";
import { ingestWishlistItem, ingestLibraryItem } from "@/lib/sources/ingest";
import { removeWatchlistSource, removeLibrarySource } from "@/lib/matcher";

// Wall-clock budget for a single sync request (P6). The full ~1,700-item
// Trakt+Steam+TMDB sync in ONE request spiked memory past Railway's 512 MB and
// blocked the request; instead each request now processes whole providers only
// until this budget is spent, then returns the `remaining` provider ids so the
// caller can resume in a fresh request (memory reclaimed between calls). Tunable
// via SYNC_BUDGET_MS; a single provider always runs to completion (≥1 provider
// of progress per request), so this bounds latency without stalling.
export const DEFAULT_SYNC_BUDGET_MS = 25_000;

export function syncBudgetMs(): number {
  const raw = Number(process.env.SYNC_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SYNC_BUDGET_MS;
}

// ════════════════════════════════════════════════════════════════════════════
//  Generic sync — pulls every connected provider's wishlist + library through
//  the MediaSource adapter, then upserts / enriches / prunes. This replaces the
//  former hand-written syncTrakt/syncSteam/syncRawg/syncLetterboxd (+ *Library)
//  functions: adding a platform now needs only its adapter, not a sync routine.
// ════════════════════════════════════════════════════════════════════════════

export interface ProviderSyncResult {
  provider: string;
  wishlist: number;
  library: number;
  error?: string;
}

function logSync(userId: string, provider: string, count: number, status: string, error?: string) {
  run(
    "INSERT INTO sync_log (id, user_id, provider, item_count, status, error) VALUES (?, ?, ?, ?, ?, ?)",
    [randomUUID(), userId, provider, count, status, error ?? null]
  );
}

// Remove watchlist/library links for a source whose ids are no longer present.
function pruneWatchlist(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
     WHERE uw.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeWatchlistSource(userId, e.media_item_id, source as any);
  }
}

function pruneLibrary(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_library ul ON ul.media_item_id = ml.media_item_id
     WHERE ul.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeLibrarySource(userId, e.media_item_id, source as any);
  }
}

// Pull + ingest one provider's wishlist and library per its declared capabilities.
export async function syncProvider(userId: string, src: MediaSource): Promise<ProviderSyncResult> {
  const ctx = await src.context(userId);
  if (!ctx) return { provider: src.id, wishlist: 0, library: 0, error: "not connected" };

  let wishlist = 0;
  let library = 0;

  // ── Wishlist ──
  if (src.capabilities.wishlist.read && src.pullWishlist) {
    try {
      const items = await src.pullWishlist(ctx);
      const syncedIds = new Set<string>();
      for (const item of items) {
        await ingestWishlistItem(userId, src, item);
        syncedIds.add(item.sourceId);
      }
      pruneWatchlist(userId, src.id, syncedIds);
      wishlist = syncedIds.size;
      logSync(userId, src.id, wishlist, "ok");
    } catch (e: any) {
      logSync(userId, src.id, wishlist, "error", e.message);
      return { provider: src.id, wishlist, library, error: e.message };
    }
  }

  // ── Library (watched / played / owned, with personal scores) ──
  if (src.capabilities.library.read && src.pullLibrary) {
    try {
      const items = await src.pullLibrary(ctx);
      const syncedIds = new Set<string>();
      for (const item of items) {
        await ingestLibraryItem(userId, src, item);
        syncedIds.add(item.sourceId);
      }
      pruneLibrary(userId, src.id, syncedIds);
      library = syncedIds.size;
      logSync(userId, `${src.id}-library`, library, "ok");
    } catch (e: any) {
      logSync(userId, `${src.id}-library`, library, "error", e.message);
    }
  }

  return { provider: src.id, wishlist, library };
}

export interface SyncRunResult {
  results: ProviderSyncResult[];
  done: boolean;       // false → budget spent, more providers remain
  remaining: string[]; // provider ids not yet synced this pass (resume with these)
}

export interface SyncOptions {
  only?: string;        // "all" | a specific provider id | undefined (→ all)
  providers?: string[]; // explicit resume subset (overrides `only` when non-empty)
  budgetMs?: number;    // wall-clock budget; Infinity → drain in one pass
  now?: () => number;   // injectable clock (tests)
}

// The ordered, registry-filtered list of provider ids to sync for this request.
// A client-supplied `providers` resume list is intersected with the registry so
// junk ids can't drive work. Registry order is preserved.
export function providerQueue(only?: string, providers?: string[]): string[] {
  const all = Object.values(SOURCES)
    .filter((s): s is MediaSource => !!s)
    .map((s) => s.id);
  if (providers && providers.length) return all.filter((id) => providers.includes(id));
  if (only && only !== "all") return all.filter((id) => id === only);
  return all;
}

// Pure orchestration (no DB/network) so the budget/resume contract is unit
// testable: process the queue one provider at a time, stop STARTING new
// providers once the budget is spent, but always finish the current provider and
// always make at least one provider of progress. Returns the untouched tail as
// `remaining`.
export async function orchestrateSync<T>(
  queue: string[],
  budgetMs: number,
  processOne: (id: string) => Promise<T>,
  now: () => number = Date.now,
): Promise<{ results: T[]; done: boolean; remaining: string[] }> {
  const start = now();
  const results: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    results.push(await processOne(queue[i]));
    if (now() - start >= budgetMs && i < queue.length - 1) {
      return { results, done: false, remaining: queue.slice(i + 1) };
    }
  }
  return { results, done: true, remaining: [] };
}

// Resumable, time-budgeted sync (P6). Syncs whole providers until the budget is
// spent; the caller re-invokes with `remaining` until `done`.
export async function runSync(userId: string, opts: SyncOptions = {}): Promise<SyncRunResult> {
  const queue = providerQueue(opts.only, opts.providers);
  const budgetMs = opts.budgetMs ?? syncBudgetMs();
  return orchestrateSync(
    queue,
    budgetMs,
    async (id) => {
      const src = getSource(id)!; // queue is registry-filtered, so this is defined
      return syncProvider(userId, src);
    },
    opts.now,
  );
}

// Backward-compatible one-shot: drain every provider in a single pass (no budget).
// For non-HTTP callers that want the whole result set synchronously.
export async function syncProviders(userId: string, only?: string): Promise<ProviderSyncResult[]> {
  const { results } = await runSync(userId, { only, budgetMs: Infinity });
  return results;
}
