"use client";
import { EnrichedItem, MediaType } from "@/types";
import FacetLink from "@/components/FacetLink";
import { Fact } from "./primitives";
import { fmtRuntime, fmtMoney, fmtDate } from "./format";

// Credits (director / developer / publisher chips), the facts grid, next-episode
// and awards lines — the read-only "facts" block of the item detail headline.
export default function FactsSection({ enriched, type }: { enriched: EnrichedItem | null; type: MediaType }) {
  const developer      = enriched?.developer ?? null;
  const publisher      = enriched?.publisher ?? null;
  const director       = enriched?.director ?? null;
  const runtimeMinutes = enriched?.runtimeMinutes ?? null;
  const certification  = enriched?.certification ?? [];
  const status         = enriched?.status ?? null;
  const collection     = enriched?.collection ?? null;
  const originalLanguage = enriched?.originalLanguage ?? null;
  const country        = enriched?.country ?? null;
  const budget         = enriched?.budget ?? null;
  const revenue        = enriched?.revenue ?? null;
  const boxOffice      = enriched?.boxOffice ?? null;
  const awards         = enriched?.awards ?? null;
  const network        = enriched?.network ?? null;
  const seasonCount    = enriched?.seasonCount ?? null;
  const episodeCount   = enriched?.episodeCount ?? null;
  const nextEpisode    = enriched?.nextEpisode ?? null;
  const playtimeHours  = enriched?.playtimeHours ?? null;
  const timeToBeat     = enriched?.timeToBeat ?? null;

  return (
    <>
      {/* Dev / pub / director — chip UI (T13) */}
      {(developer || publisher || director) && (
        <div className="flex flex-wrap gap-1.5">
          {director && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-neutral-800/60 border border-neutral-700">
              <span className="text-neutral-500">{type === "show" ? "Creator" : "Director"}</span>
              <FacetLink kind="person" role={type === "show" ? "creator" : "director"} label={director} className="text-neutral-200 hover:text-white hover:underline" />
            </span>
          )}
          {developer && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-neutral-800/60 border border-neutral-700">
              <span className="text-neutral-500">Developer</span>
              <FacetLink kind="company" role="developer" label={developer} className="text-neutral-200 hover:text-white hover:underline" />
            </span>
          )}
          {publisher && publisher !== developer && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-neutral-800/60 border border-neutral-700">
              <span className="text-neutral-500">Publisher</span>
              <FacetLink kind="company" role="publisher" label={publisher} className="text-neutral-200 hover:text-white hover:underline" />
            </span>
          )}
        </div>
      )}

      {/* Facts grid */}
      {(runtimeMinutes || certification.length || status || network || seasonCount || collection || originalLanguage || country || budget || revenue || boxOffice || playtimeHours || timeToBeat) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-1">
          {certification.length > 0 && <Fact label="Rated">{certification.join(" · ")}</Fact>}
          {runtimeMinutes && <Fact label="Runtime">{fmtRuntime(runtimeMinutes)}{type === "show" ? "/ep" : ""}</Fact>}
          {status && <Fact label="Status">{status}</Fact>}
          {network && <Fact label="Network">{network}</Fact>}
          {type === "show" && (seasonCount || episodeCount) && (
            <Fact label="Episodes">{seasonCount ? `${seasonCount} season${seasonCount > 1 ? "s" : ""}` : ""}{seasonCount && episodeCount ? " · " : ""}{episodeCount ? `${episodeCount} eps` : ""}</Fact>
          )}
          {collection && <Fact label={type === "game" ? "Franchise" : "Collection"}>{collection}</Fact>}
          {originalLanguage && <Fact label="Language">{originalLanguage}</Fact>}
          {country && <Fact label="Country">{country}</Fact>}
          {playtimeHours && <Fact label="Avg playtime">{playtimeHours}h</Fact>}
          {timeToBeat?.normally != null && <Fact label="Time to beat">{timeToBeat.normally}h</Fact>}
          {budget && <Fact label="Budget">{fmtMoney(budget)}</Fact>}
          {(boxOffice || revenue) && <Fact label="Box office">{boxOffice ?? fmtMoney(revenue!)}</Fact>}
        </div>
      )}

      {/* Next episode (returning shows) */}
      {nextEpisode?.airDate && (
        <p className="text-sm">
          <span className="text-neutral-500">Next episode </span>
          <span className="text-neutral-200">
            {nextEpisode.season != null && nextEpisode.episode != null ? `S${nextEpisode.season}E${nextEpisode.episode} · ` : ""}
            {fmtDate(nextEpisode.airDate)}
          </span>
        </p>
      )}

      {/* Awards */}
      {awards && <p className="text-sm text-amber-300/80">🏆 {awards}</p>}
    </>
  );
}
