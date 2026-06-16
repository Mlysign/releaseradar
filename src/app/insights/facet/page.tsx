"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import PosterCard, { PosterCardItem } from "@/components/PosterCard";
import { buildItemHref } from "@/lib/itemUrl";
import { ROLE_LABELS } from "@/lib/constants";
import { FacetDetailPayload } from "@/components/insights/types";

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="text-xs text-neutral-400 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-neutral-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// One bar of the you-vs-crowd comparison. Module-scoped so it isn't re-created
// as a new component type on every CompareBars render (react-hooks/static-components).
function CompareRow({ label, v, color }: { label: string; v: number | null; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-xs text-neutral-400">{label}</span>
      <div className="relative flex-1 h-3 rounded-full bg-neutral-800 overflow-hidden">
        {v != null && <div className="h-full rounded-full" style={{ width: `${(v / 10) * 100}%`, background: color }} />}
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-neutral-300">{v != null ? v.toFixed(1) : "—"}</span>
    </div>
  );
}

// Two-bar comparison (you vs crowd) on a 0-10 scale.
function CompareBars({ you, crowd }: { you: number | null; crowd: number | null }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-2">
      <CompareRow label="You" v={you} color="#4ade80" />
      <CompareRow label="Crowd" v={crowd} color="#60a5fa" />
    </div>
  );
}

function Bio({ bio }: { bio: string }) {
  const [open, setOpen] = useState(false);
  const long = bio.length > 360;
  return (
    <div className="text-sm text-neutral-400 leading-relaxed">
      <p className={open ? "" : "line-clamp-4"}>{bio}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-neutral-500 hover:text-white mt-1">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function FacetDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get("kind");
  const role = params.get("role") || undefined;
  const key = params.get("key");
  const label = params.get("label") ?? key ?? "";

  const [data, setData] = useState<FacetDetailPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!kind || !key) { setStatus("error"); return; }
    setStatus("loading");
    const qs = new URLSearchParams({ kind, key, label });
    if (role) qs.set("role", role);
    fetch(`/api/insights/facet?${qs.toString()}`)
      .then((r) => { if (r.status === 401) { router.push("/"); throw new Error("unauth"); } if (!r.ok) throw new Error("failed"); return r.json(); })
      .then((d: FacetDetailPayload) => { setData(d); setStatus("ready"); })
      .catch(() => setStatus((s) => (s === "loading" ? "error" : s)));
  }, [kind, role, key, label, router]);

  const roleLabel = kind === "tag" ? "Tag" : role ? (ROLE_LABELS[role] ?? role) : kind ?? "";

  if (status === "error") {
    return <div className="text-center py-20 text-neutral-500"><p className="mb-3">Couldn&apos;t load this.</p><Link href="/insights" className="text-xs underline">Back to Insights</Link></div>;
  }
  if (status === "loading" || !data) {
    return <div className="text-center py-20 text-neutral-500 animate-pulse">Loading {label}…</div>;
  }

  const s = data.stats;
  const ext = data.scope !== "catalog";
  const crowdLabel = data.scope === "filmography" ? "Crowd (full filmography)" : data.scope === "sample" ? "Crowd (popular + recent)" : "Crowd (your titles)";
  const countLabel = data.scope === "filmography" ? "Filmography" : data.scope === "sample" ? "Titles" : "In your catalog";
  const itemsNote = data.scope === "filmography" ? " — the rest is their full TMDB filmography; titles you don't have show no badges"
    : data.scope === "sample" ? " — the rest is a popular + recent sample from TMDB/RAWG; titles you don't have show no badges" : "";
  const deltaTxt =
    s.delta == null ? null : s.delta > 0 ? `You rate ${label} ${s.delta.toFixed(1)} higher than the crowd`
      : s.delta < 0 ? `You rate ${label} ${Math.abs(s.delta).toFixed(1)} lower than the crowd`
      : `You rate ${label} the same as the crowd`;

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <Link href="/insights" className="text-xs text-neutral-500 hover:text-white">← Insights</Link>

      {/* Header / person bio */}
      <div className="mt-3 mb-6 flex gap-5">
        {data.person?.profileUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.person.profileUrl} alt={label} className="w-28 h-40 rounded-xl object-cover border border-neutral-800 shrink-0" />
        )}
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">{roleLabel}</span>
          <h1 className="text-2xl font-bold">{label}</h1>
          {data.person && (
            <p className="text-sm text-neutral-500 mt-0.5">
              {[
                data.person.knownForDepartment,
                data.person.birthday ? `Born ${data.person.birthday}${data.person.age != null ? ` · age ${data.person.age}${data.person.deathday ? " at death" : ""}` : ""}` : null,
                data.person.placeOfBirth,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {data.person?.biography && <div className="mt-2 max-w-3xl"><Bio bio={data.person.biography} /></div>}
          {data.person && <a href={data.person.tmdbUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline mt-1 inline-block">View on TMDB ↗</a>}
        </div>
      </div>

      {/* Stats */}
      {deltaTxt && (
        <p className="text-sm mb-3">
          <span className={s.delta! > 0 ? "text-emerald-400" : s.delta! < 0 ? "text-rose-400" : "text-neutral-300"}>{deltaTxt}</span>
          <span className="text-neutral-600"> · your overall average is {s.baseline.toFixed(1)}</span>
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
        <StatCard label="Your average" value={s.userAvg != null ? s.userAvg.toFixed(1) : "—"} sub={`${s.userCount} rated`} accent="#4ade80" />
        <StatCard label={crowdLabel} value={s.communityAvg != null ? s.communityAvg.toFixed(1) : "—"} sub={ext ? `${s.crowdCount} titles` : undefined} accent="#60a5fa" />
        <StatCard label="You vs crowd" value={s.delta != null ? `${s.delta > 0 ? "+" : ""}${s.delta.toFixed(1)}` : "—"} accent={s.delta != null ? (s.delta >= 0 ? "#4ade80" : "#f87171") : undefined} />
        <StatCard label="Your overall avg" value={s.baseline.toFixed(1)} />
        <StatCard label={countLabel} value={String(s.totalCount)} sub="titles" />
      </div>
      <div className="mb-8 max-w-xl"><CompareBars you={s.userAvg} crowd={s.communityAvg} /></div>

      {/* Items */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300 mb-1">Titles {kind === "person" ? "they appear in" : "with this"}</h2>
      <p className="text-xs text-neutral-600 mb-3">
        Your rated titles first{itemsNote}.{" "}
        {data.shown < s.totalCount ? `Showing ${data.shown} of ${s.totalCount}.` : `${s.totalCount} titles.`}
      </p>
      {data.items.length === 0 ? (
        <p className="text-sm text-neutral-500 py-8 text-center">Nothing in your catalog yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {data.items.map((item) => (
            <PosterCard key={item.id} item={item as PosterCardItem} onSelect={() => router.push(buildItemHref(item as any))} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function FacetPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Suspense fallback={<div className="text-center py-20 text-neutral-500 animate-pulse">Loading…</div>}>
        <FacetDetail />
      </Suspense>
    </div>
  );
}
