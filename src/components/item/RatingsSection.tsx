"use client";
import { Dispatch, SetStateAction } from "react";
import { format } from "date-fns";
import { MediaType, CommunityRating } from "@/types";
import { ScoreBadge, RatingsBreakdown } from "./primitives";
import { fmtScore, ratingsTooltip } from "./format";

type PersonalRating = { source: string; rating: number };

// Ratings cluster (T13): platform/community/critic scores and the user's own
// 10-star rating + log, co-located in one section.
export default function RatingsSection({
  type, hasScores, communityRatings, steamReview,
  canRate, personalRating, personalRatings, libraryStatus, reviewedAt, review,
  hoverRating, setHoverRating, ratingAction, onRate, onMarkWatched,
}: {
  type: MediaType;
  hasScores: boolean;
  communityRatings: CommunityRating[];
  steamReview: string | null;
  canRate: boolean;
  personalRating: number | null;
  personalRatings: PersonalRating[];
  libraryStatus: string | null;
  reviewedAt: number | null;
  review: string | null;
  hoverRating: number | null;
  setHoverRating: Dispatch<SetStateAction<number | null>>;
  ratingAction: boolean;
  onRate: (n: number | null) => void;
  onMarkWatched: () => void;
}) {
  const hasPersonal = typeof personalRating === "number" && personalRating > 0;
  if (!(hasScores || canRate || libraryStatus || hasPersonal || reviewedAt || review)) return null;

  return (
    <div className="space-y-3">
      {/* Platform / community / critic scores */}
      {(hasScores || hasPersonal) && (
        <div className="flex items-center gap-2 flex-wrap">
          {communityRatings.map((r) => <ScoreBadge key={r.source} r={r} />)}
          {steamReview && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm" style={{ background: "#1b9af71f", color: "#1b9af7" }}>
              <span className="text-[10px] uppercase tracking-wide opacity-80 font-bold">Steam</span>
              {steamReview}
            </span>
          )}
        </div>
      )}

      {/* Your rating — 10-star scale, in the same section as platform ratings */}
      {canRate ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Your rating</p>
          <div className="flex items-center gap-0.5 mb-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const active = n <= (hoverRating ?? personalRating ?? 0);
              return (
                <button
                  key={n}
                  className="text-2xl leading-none transition-colors disabled:opacity-40"
                  style={{ color: active ? "#facc15" : "#3f3f46" }}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(null)}
                  onClick={() => onRate(n === personalRating ? null : n)}
                  disabled={ratingAction}
                  title={n === personalRating ? "Remove rating" : `Rate ${n}/10`}
                >★</button>
              );
            })}
            {personalRating != null && (
              <span className="text-xs text-neutral-500 ml-2" title={ratingsTooltip(personalRatings)}>
                {fmtScore(personalRating)}/10{personalRatings.length > 1 ? " avg" : ""}
              </span>
            )}
          </div>
          <RatingsBreakdown ratings={personalRatings} />
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {libraryStatus ? (
              <span className="text-xs text-neutral-500 capitalize">
                ✓ {libraryStatus}
                {reviewedAt && (() => { try { return ` · ${format(new Date(reviewedAt * 1000), "MMM d, yyyy")}`; } catch { return ""; } })()}
              </span>
            ) : (
              <button onClick={onMarkWatched} disabled={ratingAction} className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors disabled:opacity-40">
                {ratingAction ? "Saving…" : "Mark as " + (type === "game" ? "played" : "watched")}
              </button>
            )}
          </div>
          {review && <p className="text-sm text-neutral-300 leading-relaxed italic mt-2">&quot;{review}&quot;</p>}
        </div>
      ) : (
        (libraryStatus || hasPersonal || review) && (
          <div className="flex items-center gap-3 flex-wrap">
            {libraryStatus && <span className="text-xs px-2 py-1 rounded-full bg-neutral-800 text-neutral-300 capitalize">{libraryStatus}</span>}
            {hasPersonal && (() => {
              const c = personalRating! >= 7 ? "#4ade80" : personalRating! >= 5 ? "#f59e0b" : "#ef4444";
              return (
                <span className="text-sm font-bold" style={{ color: c }} title={ratingsTooltip(personalRatings)}>
                  ★ {fmtScore(personalRating!)}<span className="text-neutral-600 font-normal text-xs"> / 10{personalRatings.length > 1 ? " avg" : ""}</span>
                </span>
              );
            })()}
            {review && <p className="text-sm text-neutral-300 leading-relaxed italic w-full">&quot;{review}&quot;</p>}
            <div className="w-full"><RatingsBreakdown ratings={personalRatings} /></div>
          </div>
        )
      )}
    </div>
  );
}
