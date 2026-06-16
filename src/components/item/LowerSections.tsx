"use client";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_COLORS } from "@/lib/constants";
import FacetLink from "@/components/FacetLink";
import { categorizeTag, CATEGORIES } from "@/lib/tags";
import { tagKey } from "@/lib/facets";

// The stacked lower-detail sections: trailer, cast, where-to-watch, DLC, the
// combined tags/keywords/modes/platforms block, and store links.
export default function LowerSections({ enriched, type }: { enriched: EnrichedItem | null; type: MediaType }) {
  const trailerKey      = enriched?.trailerYoutubeKey ?? null;
  const steamTrailerUrl = enriched?.steamTrailerUrl ?? null;
  const cast            = enriched?.cast ?? [];
  const streamingProviders = enriched?.streamingProviders ?? [];
  const dlc             = enriched?.dlc ?? [];
  const tags            = enriched?.tags ?? [];
  const keywords        = enriched?.keywords ?? [];
  const platformList    = enriched?.platforms ?? [];
  const gameModes       = enriched?.gameModes ?? [];
  const storeLinks      = enriched?.storeLinks ?? [];

  return (
    <div className="mt-10 space-y-8">
      {/* Trailer */}
      {trailerKey ? (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Trailer</p>
          <div className="relative w-full max-w-3xl rounded-xl overflow-hidden" style={{ paddingBottom: "min(56.25%, 480px)" }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube.com/embed/${trailerKey}?rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </section>
      ) : steamTrailerUrl ? (
        <a href={steamTrailerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg" style={{ background: "#1b9af720", color: "#1b9af7" }}>
          Watch trailer on Steam →
        </a>
      ) : null}

      {/* Cast — full list */}
      {(type === "movie" || type === "show") && cast.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Cast</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
            {cast.map((c, i) => (
              <div key={`${c.name}-${i}`} className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 flex-shrink-0 flex items-center justify-center">
                  {c.profileUrl ? (
                    <img src={c.profileUrl} alt={c.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm text-neutral-500 font-medium">{c.name?.[0] ?? "?"}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <FacetLink kind="person" role="cast" label={c.name} className="text-neutral-200 text-sm truncate block hover:text-white hover:underline" />
                  {c.character && <p className="text-neutral-500 text-xs truncate">{c.character}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Where to watch */}
      {streamingProviders.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Where to watch</p>
          <div className="flex flex-wrap gap-2">
            {streamingProviders.map((p) => (
              <div key={p.providerId} className="flex items-center gap-1.5 bg-neutral-800 rounded-lg px-2.5 py-1.5">
                {p.logoPath && <img src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} className="w-5 h-5 rounded" alt={p.name} />}
                <span className="text-xs">{p.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* DLC / expansions / included content */}
      {dlc.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">DLC &amp; expansions</p>
          <div className="flex flex-wrap gap-1.5">
            {dlc.map((d) => (
              <span key={d} className="text-xs px-2 py-0.5 bg-neutral-800 rounded-full text-neutral-300">{d}</span>
            ))}
          </div>
        </section>
      )}

      {/* Tags · keywords · modes · platforms — one section, grouped & color-coded by type (T13) */}
      {(() => {
        // Tags and keywords are the same thing: merge, dedupe by normalized key, categorize.
        const byCat = new Map<string, string[]>();
        const seen = new Set<string>();
        for (const t of [...tags, ...keywords]) {
          const k = tagKey(t);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          const cat = categorizeTag(k);
          let arr = byCat.get(cat);
          if (!arr) { arr = []; byCat.set(cat, arr); }
          arr.push(t);
        }
        type Group = { id: string; label: string; color: string; kind: "tag" | "plain"; items: string[] };
        const groups: Group[] = [];
        for (const c of CATEGORIES) {
          const items = byCat.get(c.id);
          if (items?.length) groups.push({ id: c.id, label: c.label, color: c.color, kind: "tag", items });
        }
        if (platformList.length) groups.push({ id: "platform", label: "Platforms", color: "#9ca3af", kind: "plain", items: platformList });
        if (gameModes.length) groups.push({ id: "mode", label: "Modes & perspective", color: "#9ca3af", kind: "plain", items: gameModes });
        if (!groups.length) return null;
        return (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Tags &amp; details</p>
            <div className="space-y-2.5">
              {groups.map((g) => (
                <div key={g.id} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-neutral-600 mr-1 shrink-0">{g.label}</span>
                  {g.items.map((it) =>
                    g.kind === "tag" ? (
                      <FacetLink key={it} kind="tag" label={it} className="text-xs px-2 py-0.5 rounded-full transition-all hover:brightness-125" style={{ background: `${g.color}22`, color: g.color }} />
                    ) : (
                      <span key={it} className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${g.color}1f`, color: g.color }}>{it}</span>
                    )
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Store links */}
      {storeLinks.length > 0 && (
        <section className="pt-2 border-t border-neutral-800">
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Links</p>
          <div className="flex flex-wrap gap-2">
            {storeLinks.map((l) => (
              <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: `${SOURCE_COLORS[l.source] ?? "#888"}18`, color: SOURCE_COLORS[l.source] ?? "#aaa" }}>
                {l.name} →
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
