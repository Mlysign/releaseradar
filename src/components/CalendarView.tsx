"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, isToday, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, getDay, parseISO } from "date-fns";
import { TYPE_COLORS } from "@/lib/constants";
import ItemBadges from "@/components/ItemBadges";
import Tooltip from "@/components/Tooltip";

// CalendarView accepts any item that has the minimum required fields.
// Both EnrichedItem (wishlist) and discover items satisfy this.
export interface CalendarItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  // Wishlist items have platformSources; discover items have onWatchlist
  platformSources?: string[];
  onWatchlist?: boolean;
  // Library state (watched/played + personal rating), when known
  libraryStatus?: string | null;
  rating?: number | null;
}

interface CalendarViewProps {
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  // Fired whenever the displayed month changes (and on mount). Lets a parent
  // fetch more data when the user pages past the end of what's been loaded.
  onVisibleMonthChange?: (month: Date) => void;
}

function groupByDate(items: CalendarItem[]) {
  const groups: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    if (!item.releaseDate) continue;
    if (!groups[item.releaseDate]) groups[item.releaseDate] = [];
    groups[item.releaseDate].push(item);
  }
  return groups;
}

function OverflowDrawer({
  items,
  dateLabel,
  onSelect,
  onClose,
}: {
  items: CalendarItem[];
  dateLabel: string;
  onSelect: (item: CalendarItem) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden min-w-[220px]">
        <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-400">{dateLabel}</span>
          <button onClick={onClose} aria-label="Close" className="text-neutral-600 hover:text-white text-xs"><span aria-hidden>✕</span></button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-800 transition-colors text-left"
              onClick={() => { onClose(); onSelect(item); }}
            >
              {item.posterUrl && (
                <img src={item.posterUrl} alt={item.title} className="w-8 h-6 rounded object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{item.title}</p>
                <div className="mt-0.5"><ItemBadges variant="calendar" item={item} /></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function HoverableCalendarItem({ item, onSelect }: { item: CalendarItem; onSelect: (item: CalendarItem) => void }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <>
      <button
        ref={ref}
        className="flex items-center gap-1 text-left w-full hover:opacity-75 transition-opacity"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
      >
        <ItemBadges variant="calendar" item={item} />
        <span className="text-xs text-neutral-200 truncate leading-tight">{item.title}</span>
      </button>
      {hovered && <Tooltip item={item} anchorRef={ref} />}
    </>
  );
}

function CalendarCell({
  day,
  dayItems,
  onSelect,
}: {
  day: Date;
  dayItems: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [singleHovered, setSingleHovered] = useState(false);
  const singleRef = useRef<HTMLDivElement>(null);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = isToday(day);
  const single = dayItems.length === 1 ? dayItems[0] : null;
  const VISIBLE = 3;
  const overflow = dayItems.length > VISIBLE;

  return (
    <div
      className="h-32 rounded-xl overflow-visible relative border transition-colors"
      style={{
        borderColor: today
          ? "rgba(255,255,255,0.3)"
          : single
          ? `${TYPE_COLORS[single.type]}44`
          : dayItems.length > 0
          ? "rgb(55,55,55)"
          : "rgb(38,38,38)",
        background: single ? "transparent" : "rgba(23,23,23,0.4)",
      }}
    >
      {single && single.posterUrl && (
        <>
          <img
            src={single.posterUrl}
            alt={single.title}
            className="absolute inset-0 w-full h-full object-cover opacity-40 rounded-xl"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent rounded-xl" />
        </>
      )}

      <div className="relative z-10 p-2 h-full flex flex-col">
        {/* Day number */}
        <div className="mb-1">
          {today ? (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-neutral-900 font-bold text-xs">
              {format(day, "d")}
            </span>
          ) : (
            <span className="text-xs text-neutral-500">{format(day, "d")}</span>
          )}
        </div>

        {single ? (
          <>
            <div
              ref={singleRef}
              className="flex-1 flex flex-col justify-end cursor-pointer"
              onMouseEnter={() => { singleTimer.current = setTimeout(() => setSingleHovered(true), 350); }}
              onMouseLeave={() => { if (singleTimer.current) clearTimeout(singleTimer.current); setSingleHovered(false); }}
              onClick={() => onSelect(single)}
            >
              <p className="text-xs font-medium text-white leading-tight line-clamp-2 drop-shadow">{single.title}</p>
              <div className="mt-0.5"><ItemBadges variant="calendar" item={single} /></div>
            </div>
            {singleHovered && <Tooltip item={single} anchorRef={singleRef} />}
          </>
        ) : dayItems.length > 0 ? (
          <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
            {dayItems.slice(0, VISIBLE).map((item) => (
              <HoverableCalendarItem key={item.id} item={item} onSelect={onSelect} />
            ))}
            {overflow && (
              <div className="relative mt-auto">
                <button
                  className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setShowOverflow(true); }}
                >
                  +{dayItems.length - VISIBLE} more
                </button>
                {showOverflow && (
                  <OverflowDrawer
                    items={dayItems}
                    dateLabel={format(day, "MMMM d")}
                    onSelect={onSelect}
                    onClose={() => setShowOverflow(false)}
                  />
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CalendarView({ items, onSelect, onVisibleMonthChange }: CalendarViewProps) {
  const [calMonth, setCalMonth] = useState(new Date());

  useEffect(() => {
    onVisibleMonthChange?.(calMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calMonth]);

  const monthStart    = startOfMonth(calMonth);
  const monthEnd      = endOfMonth(calMonth);
  const days          = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad      = getDay(monthStart);
  const groups        = groupByDate(items);
  const isCurrentMonth = isSameMonth(calMonth, new Date());

  const monthItemCount = days.reduce((acc, day) => acc + (groups[format(day, "yyyy-MM-dd")]?.length ?? 0), 0);

  // Distinct months (as start-of-month timestamps) that actually hold a release,
  // so the user can skip empty stretches instead of paging one month at a time.
  const monthStarts = useMemo(() => {
    const set = new Set<number>();
    for (const it of items) {
      if (!it.releaseDate) continue;
      set.add(startOfMonth(parseISO(it.releaseDate)).getTime());
    }
    return [...set].sort((a, b) => a - b);
  }, [items]);
  const curStart = startOfMonth(calMonth).getTime();
  const nextMonthWithItems = monthStarts.find((m) => m > curStart) ?? null;
  const prevMonthWithItems = [...monthStarts].reverse().find((m) => m < curStart) ?? null;

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => setCalMonth(subMonths(calMonth, 1))}
          className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
        >
          ←
        </button>
        <div className="flex items-center gap-3">
          <div className="text-center">
            {isCurrentMonth ? (
              // Current month: white pill — same treatment as list/card divider
              <h2 className="font-bold text-sm px-3 py-1.5 rounded-full bg-white text-neutral-900 uppercase tracking-widest inline-block">
                {format(calMonth, "MMMM yyyy")}
              </h2>
            ) : (
              <h2 className="font-semibold">{format(calMonth, "MMMM yyyy")}</h2>
            )}
            {monthItemCount > 0 && (
              <p className="text-xs text-neutral-500 mt-1">{monthItemCount} release{monthItemCount !== 1 ? "s" : ""}</p>
            )}
          </div>
          {!isCurrentMonth && (
            <button
              onClick={() => setCalMonth(new Date())}
              className="text-xs px-3 py-1.5 bg-white text-neutral-900 hover:bg-neutral-100 font-semibold rounded-full transition-colors shadow"
            >
              Today
            </button>
          )}
          {monthItemCount > 0 && nextMonthWithItems != null && (
            <button
              onClick={() => setCalMonth(new Date(nextMonthWithItems))}
              className="text-xs px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors whitespace-nowrap"
              title="Jump to the next month with a release"
            >
              Next release →
            </button>
          )}
        </div>
        <button
          onClick={() => setCalMonth(addMonths(calMonth, 1))}
          className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
        >
          →
        </button>
      </div>

      {monthItemCount === 0 ? (
        // Empty month — offer to skip straight to a month that has releases.
        <div className="text-center py-16 text-neutral-500 rounded-2xl border border-dashed border-neutral-800">
          <p className="mb-3">No releases in {format(calMonth, "MMMM yyyy")}.</p>
          {prevMonthWithItems == null && nextMonthWithItems == null ? (
            <span className="text-xs">No dated releases here yet.</span>
          ) : (
            <div className="flex items-center justify-center gap-2">
              {prevMonthWithItems != null && (
                <button
                  onClick={() => setCalMonth(new Date(prevMonthWithItems))}
                  className="text-xs px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors"
                >
                  ← Previous release
                </button>
              )}
              {nextMonthWithItems != null && (
                <button
                  onClick={() => setCalMonth(new Date(nextMonthWithItems))}
                  className="text-xs px-3 py-1.5 rounded-full bg-white text-neutral-900 font-semibold hover:bg-neutral-100 transition-colors shadow"
                >
                  Jump to next release →
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center text-xs text-neutral-600 py-1 font-medium">{d}</div>
            ))}
          </div>

          {/* Calendar grid — subtle white glow on current month */}
          <div
            className="grid grid-cols-7 gap-1.5 rounded-2xl p-2 -m-2 transition-colors"
            style={isCurrentMonth ? { background: "rgba(255,255,255,0.02)" } : undefined}
          >
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} className="h-32 rounded-xl" />
            ))}
            {days.map((day) => {
              const dateStr  = format(day, "yyyy-MM-dd");
              const dayItems = groups[dateStr] || [];
              return (
                <CalendarCell
                  key={day.toISOString()}
                  day={day}
                  dayItems={dayItems}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
