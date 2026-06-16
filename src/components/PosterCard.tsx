"use client";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { TYPE_COLORS } from "@/lib/constants";
import Tooltip from "@/components/Tooltip";
import type { TooltipItem } from "@/components/Tooltip";
import { TypeIcon } from "@/components/Badges";
import ActionCells from "@/components/ActionCells";
import { MediaCardItem } from "@/components/cardItem";

// The shared media-item shape (see cardItem.ts). Re-exported as PosterCardItem
// for the existing call-sites that import it from here.
export type PosterCardItem = MediaCardItem;

interface PosterCardProps {
  item: PosterCardItem;
  onSelect: (item: PosterCardItem) => void;
}

export default function PosterCard({ item, onSelect }: PosterCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Games carry LANDSCAPE header art (Steam/RAWG); letterbox it over a blurred
  // fill so the title isn't sliced by the 2:3 portrait frame (U15).
  const isGame = item.type === "game";
  const typeColor = TYPE_COLORS[item.type] ?? "#888";

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.title} — view details`}
        className="group cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all hover:scale-[1.02] relative"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
        // Keyboard activation, but only when focus is on the card itself — not on
        // a nested action button (which handles its own Enter/Space).
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item); }
        }}
      >
        {/* Type accent — color-coded top bar carrying the type icon (T11) */}
        <div className="h-5 rounded-t-xl flex items-center px-2" style={{ background: typeColor }}>
          <span className="text-black/75"><TypeIcon type={item.type} size={13} /></span>
        </div>

        {/* Poster image — 2:3 portrait ratio */}
        <div className="relative w-full bg-neutral-800 overflow-hidden" style={{ paddingBottom: "150%" }}>
          {item.posterUrl && !imgErr ? (
            isGame ? (
              <>
                <img src={item.posterUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-40" />
                <img src={item.posterUrl} alt={item.title} className="absolute inset-0 w-full h-full object-contain" onError={() => setImgErr(true)} />
              </>
            ) : (
              <img src={item.posterUrl} alt={item.title} className="absolute inset-0 w-full h-full object-cover" onError={() => setImgErr(true)} />
            )
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-600">
              <TypeIcon type={item.type} size={28} />
              <span className="text-2xl font-bold">{item.title[0]}</span>
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-all text-xs text-white bg-black/60 px-3 py-1.5 rounded-lg">
              View details
            </span>
          </div>
        </div>

        {/* Action toolbar — rate · watched · wishlist (always visible) */}
        <div className="px-2 pt-2">
          <ActionCells item={item} layout="card" />
        </div>

        {/* Footer — title + date (type now reads from the color-coded top bar) */}
        <div className="px-2.5 pb-2.5 pt-1.5 space-y-0.5">
          <p className="font-medium text-sm leading-tight line-clamp-2">{item.title}</p>
          <div className="text-xs text-neutral-500">
            {item.releaseDate
              ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
              : "TBA"}
          </div>
        </div>
      </div>

      {hovered && (
        <Tooltip item={item as TooltipItem} anchorRef={ref} />
      )}
    </>
  );
}
