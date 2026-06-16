"use client";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import Tooltip, { TooltipItem } from "@/components/Tooltip";
import { TypeIcon } from "@/components/Badges";
import ActionCells from "@/components/ActionCells";
import { TYPE_COLORS } from "@/lib/constants";
import { MediaCardItem } from "@/components/cardItem";

// The list-view analog of PosterCard: one canonical, reusable row used wherever
// items render as a list (GroupedView list mode, and anywhere else in future).
export type ListCardItem = MediaCardItem;

interface ListCardProps {
  item: ListCardItem;
  onSelect: (item: ListCardItem) => void;
  highlight?: boolean;
}

export default function ListCard({ item, onSelect, highlight }: ListCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canTooltip = item.dates !== undefined;
  const typeColor = TYPE_COLORS[item.type] ?? "#888";
  // The list row uses a LANDSCAPE thumbnail (the card uses the portrait poster):
  // prefer the merged landscape backdrop, fall back to the poster when absent.
  const thumb = item.backdropUrl ?? item.posterUrl;

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.title} — view details`}
        className={`flex items-stretch bg-neutral-900 hover:bg-neutral-800/80 border rounded-xl overflow-hidden transition-colors cursor-pointer group ${
          highlight ? "border-white/20" : "border-neutral-800"
        }`}
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
        // Keyboard activation, but only when focus is on the row itself — not on
        // a nested action button (which handles its own Enter/Space).
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item); }
        }}
      >
        {/* Type accent — color-coded left bar carrying the type icon (T11) */}
        <div className="w-7 flex-shrink-0 flex items-center justify-center" style={{ background: typeColor }}>
          <span className="text-black/75"><TypeIcon type={item.type} size={15} /></span>
        </div>
        {/* Full-height LANDSCAPE thumbnail, flush against the color bar. The image
            is absolutely filled so its aspect ratio can't drive the row height —
            rows stay uniform; a ~16:9 backdrop fills this wide frame with minimal
            crop (vs. the portrait poster the card uses). */}
        <div className="relative w-28 flex-shrink-0 bg-neutral-800 overflow-hidden">
          {thumb && !imgErr ? (
            <img src={thumb} alt={item.title} className="absolute inset-0 w-full h-full object-cover" onError={() => setImgErr(true)} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"><TypeIcon type={item.type} size={16} className="text-neutral-600" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <p className="font-medium text-sm truncate">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-neutral-500">
            <span>
              {item.releaseDate
                ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
                : "TBA"}
            </span>
            {item.dates && item.dates.length > 1 && (
              <span className="text-neutral-600">· {item.dates.length} dates</span>
            )}
          </div>
        </div>
        <div className="flex items-center pr-3 flex-shrink-0">
          <ActionCells item={item} layout="row" />
        </div>
      </div>
      {hovered && canTooltip && (
        <Tooltip item={item as TooltipItem} anchorRef={ref} />
      )}
    </>
  );
}
