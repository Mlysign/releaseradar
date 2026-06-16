"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType, Source } from "@/types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import { TypeBadge, SourcePill } from "@/components/Badges";
import { SOURCE_PARAMS } from "@/lib/itemUrl";

interface DebugLink {
  source: Source;
  sourceId: string;
  origin: "db" | "live-id" | "live-search";
  title: string | null;
  releaseDate: string | null;
  lastSynced: number;
  rawBytes: number;
  tmdbRefreshed?: boolean;
}

interface MergeFieldDebug {
  field: string;
  strategy: string;
  priority: Source[];
  perSource: Partial<Record<Source, any>>;
  final: any;
  winners: Source[];
}

interface EnrichmentOutcome {
  source: Source;
  outcome: "already-linked" | "linked" | "no-match" | "not-configured" | "error" | "skipped-primary";
}

interface DebugPayload {
  resolvedVia: "uuid" | "source-id" | "live";
  mediaItemId: string | null;
  links: DebugLink[];
  enrichment: EnrichmentOutcome[];
  matrix: MergeFieldDebug[];
}

const OUTCOME_LABELS: Record<EnrichmentOutcome["outcome"], { text: string; cls: string }> = {
  "already-linked": { text: "already linked", cls: "text-neutral-500" },
  "linked": { text: "linked via title search", cls: "text-sky-400" },
  "no-match": { text: "no title match found", cls: "text-amber-400" },
  "not-configured": { text: "not configured (missing API credentials)", cls: "text-red-400" },
  "error": { text: "lookup failed", cls: "text-red-400" },
  "skipped-primary": { text: "primary catalog — never title-searched", cls: "text-neutral-500" },
};

const ORIGIN_LABELS: Record<string, string> = {
  "db": "DB (media_links)",
  "live-id": "live · id fetch",
  "live-search": "live · title search",
};

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

function fmtSynced(ts: number): string {
  if (!ts) return "live (not stored)";
  return new Date(ts * 1000).toLocaleString();
}

const isEmpty = (v: any) =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0);

// Render any extracted value compactly: scalars inline, long strings and
// arrays/objects behind a <details> expander.
function CellValue({ value }: { value: any }) {
  if (isEmpty(value)) return <span className="text-neutral-700">—</span>;
  if (Array.isArray(value) || typeof value === "object") {
    const summary = Array.isArray(value)
      ? `${value.length} item${value.length === 1 ? "" : "s"}`
      : "object";
    return (
      <details>
        <summary className="cursor-pointer text-neutral-300 hover:text-white select-none">{summary}</summary>
        <pre className="mt-1 text-[11px] leading-snug text-neutral-300 whitespace-pre-wrap break-all max-h-64 overflow-auto bg-black/40 rounded p-2">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    );
  }
  const s = String(value);
  if (s.length > 120) {
    return (
      <details>
        <summary className="cursor-pointer select-none">{s.slice(0, 120)}…</summary>
        <div className="mt-1 whitespace-pre-wrap break-words text-neutral-300">{s}</div>
      </details>
    );
  }
  return <span className="break-words">{s}</span>;
}

function sameValue(a: any, b: any): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function DebugInspector() {
  const router = useRouter();
  const sp = useSearchParams();

  const id = sp.get("id");
  const type = (sp.get("type") ?? "game") as MediaType;
  const title = sp.get("title");

  const [item, setItem] = useState<EnrichedItem | null>(null);
  const [debug, setDebug] = useState<DebugPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!id) { setError("No id in URL"); setLoading(false); return; }
    const p = new URLSearchParams();
    p.set("id", id);
    p.set("type", type);
    p.set("debug", "1");
    if (title) p.set("title", title);
    for (const k of SOURCE_PARAMS) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    fetch(`/api/detail?${p}`)
      .then(async (res) => {
        if (res.status === 401) { router.push("/"); return; }
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        setItem(data.item ?? null);
        setDebug(data.debug ?? null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <p className="text-sm text-neutral-500 animate-pulse mt-10">Loading debug data…</p>;
  }
  if (error || !item || !debug) {
    return <p className="text-sm text-red-400 mt-10">Failed to load: {error ?? "no debug payload returned"}</p>;
  }

  // Column order: as the links arrived (DB first, then live enrichment).
  const columns = debug.links.map((l) => l.source);
  const backHref = `/item?${sp.toString()}`;
  const mergedWithoutSources = { ...item, sources: undefined };

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={item.type} />
          <span className="text-xs px-2 py-0.5 rounded-full border border-amber-700 text-amber-400">debug</span>
          <Link href={backHref} className="text-xs text-neutral-400 hover:text-neutral-200 underline underline-offset-2">
            ← back to item
          </Link>
        </div>
        <h1 className="text-2xl font-bold leading-tight">{item.title}</h1>
        <p className="text-xs text-neutral-500 font-mono">
          resolved via <span className="text-neutral-300">{debug.resolvedVia}</span>
          {" · "}media_item {debug.mediaItemId ? <span className="text-neutral-300">{debug.mediaItemId}</span> : <span className="text-neutral-600">none (live-only)</span>}
        </p>
      </div>

      {/* Source links */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wide">Source links</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 bg-neutral-900/60">
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Source ID</th>
                <th className="px-3 py-2">Origin</th>
                <th className="px-3 py-2">Source title</th>
                <th className="px-3 py-2">Release date</th>
                <th className="px-3 py-2">Last synced</th>
                <th className="px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {debug.links.map((l) => (
                <tr key={l.source} className="border-t border-neutral-800/70">
                  <td className="px-3 py-2"><SourcePill source={l.source} /></td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-300">{l.sourceId}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={l.origin === "db" ? "text-emerald-400" : "text-sky-400"}>
                      {ORIGIN_LABELS[l.origin] ?? l.origin}
                    </span>
                    {l.tmdbRefreshed && <span className="ml-1.5 text-amber-400" title="Stored TMDB data was re-fetched live (missing keywords)">↻ refreshed</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{l.title ?? <span className="text-neutral-700">—</span>}</td>
                  <td className="px-3 py-2 text-neutral-300">{l.releaseDate ?? <span className="text-neutral-700">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-neutral-400">{fmtSynced(l.lastSynced)}</td>
                  <td className="px-3 py-2 text-xs text-neutral-400">{fmtBytes(l.rawBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Why a source is (or isn't) here — cross-enrichment outcomes */}
        {(debug.enrichment ?? []).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs px-1">
            {(debug.enrichment ?? []).map((e) => (
              <span key={e.source} className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[e.source] ?? "#888" }} />
                <span className="text-neutral-400">{SOURCE_LABELS[e.source] ?? e.source}:</span>
                <span className={OUTCOME_LABELS[e.outcome]?.cls ?? "text-neutral-400"}>
                  {OUTCOME_LABELS[e.outcome]?.text ?? e.outcome}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Field matrix */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wide">Merge matrix</h2>
        <p className="text-xs text-neutral-500">
          One row per merged field. Highlighted cells won the merge; dimmed cells were available but lost.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm align-top">
            <thead>
              <tr className="text-left text-xs text-neutral-500 bg-neutral-900/60">
                <th className="px-3 py-2 whitespace-nowrap">Field</th>
                <th className="px-3 py-2 whitespace-nowrap">Strategy</th>
                {columns.map((s) => (
                  <th key={s} className="px-3 py-2 whitespace-nowrap" style={{ color: SOURCE_COLORS[s] ?? "#aaa" }}>
                    {SOURCE_LABELS[s] ?? s}
                  </th>
                ))}
                <th className="px-3 py-2 whitespace-nowrap text-neutral-200">Merged</th>
              </tr>
            </thead>
            <tbody>
              {debug.matrix.map((row) => (
                <tr key={row.field} className="border-t border-neutral-800/70">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-200 whitespace-nowrap align-top">{row.field}</td>
                  <td className="px-3 py-2 text-[11px] text-neutral-500 whitespace-nowrap align-top">{row.strategy}</td>
                  {columns.map((s) => {
                    const considered = s in row.perSource;
                    const value = row.perSource[s];
                    const won = row.winners.includes(s);
                    const differs = considered && !isEmpty(value) && !won && !sameValue(value, row.final);
                    return (
                      <td
                        key={s}
                        className={`px-3 py-2 text-xs align-top max-w-[260px] ${won ? "" : differs ? "text-neutral-500" : "text-neutral-400"}`}
                        style={won ? { boxShadow: `inset 0 0 0 1px ${SOURCE_COLORS[s] ?? "#888"}`, background: `${SOURCE_COLORS[s] ?? "#888"}14` } : undefined}
                        title={!considered ? "Source not consulted for this field" : differs ? "Differs from merged value" : undefined}
                      >
                        {considered ? <CellValue value={value} /> : <span className="text-neutral-800">n/a</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-xs align-top max-w-[280px] text-neutral-100">
                    <CellValue value={row.final} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* External scores appended after merge (not part of the matrix) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wide">Post-merge (OMDB)</h2>
        <p className="text-xs text-neutral-500">Fetched by IMDb id (from TMDB/Trakt) — else title + year — after merging.</p>
        <div className="flex gap-4 text-sm text-neutral-300">
          <span>RT: {item.rtScore ?? "—"}</span>
          <span>IMDb: {item.imdbRating ?? "—"}</span>
          <span className="font-mono text-xs self-center text-neutral-500">{item.imdbId ?? ""}</span>
        </div>
      </section>

      {/* Raw payloads */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wide">Raw payloads</h2>
        {(item.sources ?? []).map((s) => (
          <details key={s.source} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLORS[s.source] ?? "#888" }} />
              <span className="font-medium">{SOURCE_LABELS[s.source] ?? s.source}</span>
              <span className="text-xs text-neutral-500 font-mono">#{s.sourceId}</span>
            </summary>
            <pre className="px-4 pb-4 text-[11px] leading-snug text-neutral-300 whitespace-pre-wrap break-all max-h-[480px] overflow-auto">
              {JSON.stringify(s.data, null, 2)}
            </pre>
          </details>
        ))}
        <details className="rounded-xl border border-neutral-700 bg-neutral-900/60">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">
            Final merged EnrichedItem <span className="text-xs text-neutral-500">(sources omitted)</span>
          </summary>
          <pre className="px-4 pb-4 text-[11px] leading-snug text-neutral-300 whitespace-pre-wrap break-all max-h-[480px] overflow-auto">
            {JSON.stringify(mergedWithoutSources, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  );
}

export default function ItemDebugPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 pt-6">
        <Suspense fallback={<p className="text-sm text-neutral-500 animate-pulse mt-10">Loading…</p>}>
          <DebugInspector />
        </Suspense>
      </main>
    </div>
  );
}
