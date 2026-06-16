"use client";
import { useEffect, useRef } from "react";
import { format, parseISO, isToday, isTomorrow, isPast, isSameMonth } from "date-fns";
import PosterCard, { PosterCardItem } from "@/components/PosterCard";
import ListCard from "@/components/ListCard";
import { MediaCardItem } from "@/components/cardItem";

// ── Shared item interface ─────────────────────────────────────────
// The canonical shape lives in cardItem.ts; aliased as MediaItem here for
// GroupedView's grouping helpers + props.
export type MediaItem = MediaCardItem;

// ── Grouping helpers ──────────────────────────────────────────────

function groupByMonth(items: MediaItem[]) {
  const monthMap = new Map<string, string[]>();
  const noDate: MediaItem[] = [];
  for (const item of items) {
    if (!item.releaseDate) { noDate.push(item); continue; }
    const monthKey = format(parseISO(item.releaseDate), "MMMM yyyy");
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
    const dates = monthMap.get(monthKey)!;
    if (!dates.includes(item.releaseDate)) dates.push(item.releaseDate);
  }
  for (const [, dates] of monthMap) dates.sort();
  // Order months chronologically (ascending) regardless of the input array's
  // order — `descending` is then the single source of display direction. (Inputs
  // may already be sorted, e.g. search results; without this they'd double-reverse.)
  const months = [...monthMap.entries()].sort((a, b) => a[1][0].localeCompare(b[1][0]));
  return { months, noDate };
}

function groupByDate(items: MediaItem[]) {
  const groups = new Map<string, MediaItem[]>();
  const noDate: MediaItem[] = [];
  for (const item of items) {
    if (!item.releaseDate) { noDate.push(item); continue; }
    if (!groups.has(item.releaseDate)) groups.set(item.releaseDate, []);
    groups.get(item.releaseDate)!.push(item);
  }
  return { groups, noDate };
}

function findTodayOrNextDate(sortedDates: string[]): string | null {
  for (const d of sortedDates) {
    if (!isPast(parseISO(d)) || isToday(parseISO(d))) return d;
  }
  // All dates are in the past (e.g. a filtered catalog of older releases) — anchor
  // on the most recent one, the closest thing to "now", instead of not scrolling.
  return sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
}

// ── MonthDivider ──────────────────────────────────────────────────

function MonthDivider({ label, past, current }: { label: string; past: boolean; current: boolean }) {
  return (
    <div className="flex items-center gap-4 py-2 mt-6 first:mt-0">
      {current ? (
        <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap px-2.5 py-1 rounded-full bg-white text-neutral-900">
          {label}
        </span>
      ) : (
        <span className={`text-xs font-semibold uppercase tracking-widest whitespace-nowrap ${past ? "text-neutral-700" : "text-neutral-500"}`}>
          {label}
        </span>
      )}
      <div className={`flex-1 h-px ${current ? "bg-white/20" : past ? "bg-neutral-800/60" : "bg-neutral-800"}`} />
    </div>
  );
}

// ── DayHeader ─────────────────────────────────────────────────────

function DayHeader({ dateStr }: { dateStr: string }) {
  const today    = isToday(parseISO(dateStr));
  const tomorrow = isTomorrow(parseISO(dateStr));
  const past     = !today && isPast(parseISO(dateStr));
  return (
    <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
      <span className={`text-xs font-medium ${today ? "text-white" : past ? "text-neutral-600" : "text-neutral-400"}`}>
        {today ? "Today" : tomorrow ? "Tomorrow" : format(parseISO(dateStr), "MMM d, yyyy")}
      </span>
      {!today && !tomorrow && (
        <span className="text-xs text-neutral-700">{format(parseISO(dateStr), "EEEE")}</span>
      )}
      {today && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-neutral-900 font-bold uppercase tracking-wide">
          today
        </span>
      )}
    </div>
  );
}

// ── Month jump nav (right-side scrubber) ──────────────────────────

function MonthNav({
  months,
  noDate,
  sectionRefs,
}: {
  months: [string, string[]][];
  noDate: MediaItem[];
  sectionRefs: React.RefObject<Map<string, HTMLElement>>;
}) {
  const now     = new Date();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // Section key for each button index — the scrubber highlights whichever
    // month section is currently scrolled into view (not the button's own
    // position, since the nav is sticky and barely moves while scrolling).
    // Keyed by month label: those anchors start at the month divider.
    const keys = months.map(([monthKey]) => monthKey);
    if (noDate.length > 0) keys.push("__nodate__");

    function applyStyles() {
      // Reference line near the top of the content viewport. The active month
      // is the last section whose top has scrolled past this line.
      const ref = window.innerHeight * 0.3;
      let activeIdx = 0;
      keys.forEach((key, i) => {
        const sec = sectionRefs.current?.get(key);
        if (sec && sec.getBoundingClientRect().top - ref <= 1) activeIdx = i;
      });

      btnRefs.current.forEach((btn, i) => {
        if (!btn) return;
        const dist    = Math.min(Math.abs(i - activeIdx) / 4, 1);
        const t       = dist * dist * (3 - 2 * dist);
        const scale   = 1 - t * 0.22;
        const opacity = 1 - t * 0.65;
        btn.style.transform       = `scale(${scale})`;
        btn.style.transformOrigin = "right center";
        btn.style.opacity         = i === activeIdx || btn.dataset.current === "1" ? "1" : String(opacity);
      });
    }

    const raf = requestAnimationFrame(applyStyles);
    window.addEventListener("scroll", applyStyles, { passive: true, capture: true });
    document.addEventListener("scroll", applyStyles, { passive: true, capture: true });

    // Observe the section divs in the main content — those actually move
    // as the user scrolls, giving us reliable position update triggers.
    const observer = new IntersectionObserver(
      () => requestAnimationFrame(applyStyles),
      { threshold: [0, 0.1, 0.5, 0.9, 1] }
    );
    sectionRefs.current?.forEach((el) => { if (el) observer.observe(el); });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", applyStyles, { capture: true });
      document.removeEventListener("scroll", applyStyles, { capture: true });
      observer.disconnect();
    };
  }, [months.length, noDate.length]);

  return (
    <div className="hidden lg:flex flex-col gap-0.5 sticky top-44 self-start pl-4 min-w-[96px]">
      {months.map(([monthKey, dates], i) => {
        const firstDate = parseISO(dates[0]);
        const current   = isSameMonth(firstDate, now);
        return (
          <button
            key={monthKey}
            ref={(el) => { btnRefs.current[i] = el; }}
            data-current={current ? "1" : "0"}
            onClick={() => sectionRefs.current?.get(monthKey)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{ transition: "transform 0.12s ease, opacity 0.12s ease" }}
            className={`text-xs text-right px-2 py-0.5 rounded hover:bg-neutral-800 whitespace-nowrap text-white ${
              current ? "font-semibold" : ""
            }`}
          >
            {format(firstDate, "MMM yy")}
            {current && <span className="ml-1 inline-block w-1 h-1 rounded-full bg-white align-middle" />}
          </button>
        );
      })}
      {noDate.length > 0 && (
        <button
          ref={(el) => { btnRefs.current[months.length] = el; }}
          data-current="0"
          onClick={() => sectionRefs.current?.get("__nodate__")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          style={{ transition: "transform 0.12s ease, opacity 0.12s ease" }}
          className="text-xs text-right px-2 py-0.5 rounded hover:bg-neutral-800 text-white whitespace-nowrap"
        >
          TBA
        </button>
      )}
    </div>
  );
}

// ── Rating grouping (T8) ──────────────────────────────────────────
// Bucket items by their (0-10) rating, highest first; unrated go last. Used by
// the userRating / platformRating sorts in place of month grouping.
function groupByRating(items: MediaItem[], ratingOf: (i: MediaItem) => number | null) {
  const buckets = new Map<number, MediaItem[]>();
  const unrated: MediaItem[] = [];
  for (const item of items) {
    const r = ratingOf(item);
    if (r == null) { unrated.push(item); continue; }
    const b = Math.min(10, Math.max(0, Math.floor(r)));
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(item);
  }
  const ordered = [...buckets.entries()].sort((a, b) => b[0] - a[0]); // high → low
  return { ordered, unrated };
}

function RatingDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 py-2 mt-6 first:mt-0">
      <span className="text-xs font-semibold uppercase tracking-widest whitespace-nowrap text-neutral-400">{label}</span>
      <div className="flex-1 h-px bg-neutral-800" />
    </div>
  );
}

// Simple click-to-scroll side nav (rating buckets). Lighter than MonthNav's spy.
function SectionNav({ entries, sectionRefs }: { entries: [string, string][]; sectionRefs: React.RefObject<Map<string, HTMLElement>> }) {
  return (
    <div className="hidden lg:flex flex-col gap-0.5 sticky top-44 self-start pl-4 min-w-[96px]">
      {entries.map(([key, label]) => (
        <button
          key={key}
          onClick={() => sectionRefs.current?.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="text-xs text-right px-2 py-0.5 rounded hover:bg-neutral-800 whitespace-nowrap text-white"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Main GroupedView ──────────────────────────────────────────────

interface GroupedViewProps {
  items: MediaItem[];
  view: "list" | "card";
  onSelect: (item: MediaItem) => void;
  highlightId?: string | null;
  // Sort-driven layout (T8): how to group/divide the list.
  groupBy?: "month" | "rating" | "none";
  // Newest-first for date grouping (reverses month + day order; no today-scroll).
  descending?: boolean;
  // 0-10 rating accessor for groupBy="rating".
  ratingOf?: (item: MediaItem) => number | null;
}

const cardGrid = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4";

export default function GroupedView({ items, view, onSelect, highlightId, groupBy = "month", descending = false, ratingOf }: GroupedViewProps) {
  const sectionRefs   = useRef<Map<string, HTMLElement>>(new Map());
  const todayScrolled = useRef(false);

  const { groups, noDate } = groupByDate(items);
  const sortedDates = [...groups.keys()].sort();
  const monthGroups = groupByMonth(items);
  const months = descending ? [...monthGroups.months].reverse() : monthGroups.months;

  useEffect(() => { todayScrolled.current = false; }, [view, descending]);

  useEffect(() => {
    if (groupBy !== "month") return; // date-sorted timelines auto-scroll to today (both directions)
    if (todayScrolled.current || items.length === 0) return;
    const target = findTodayOrNextDate(sortedDates);
    if (!target) return;
    // Card view keys sections by the month's first date, not every day, so the
    // exact target date often isn't a section key — fall back to its month.
    const monthFirst = months.find(([, dates]) => dates.includes(target))?.[1][0];
    const timer = setTimeout(() => {
      const el =
        sectionRefs.current.get(target) ??
        (monthFirst ? sectionRefs.current.get(monthFirst) : undefined);
      // Only commit if the node is actually in the document — guards against
      // scrolling a stale/detached ref and then never retrying.
      if (el && el.isConnected) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        todayScrolled.current = true;
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [items, view, descending]);

  // Only show the month nav when there are enough months to be useful
  const showNav = months.length > 1 || noDate.length > 0;

  // ── RATING grouping (userRating / platformRating sorts) ───────
  if (groupBy === "rating") {
    const { ordered, unrated } = groupByRating(items, ratingOf ?? (() => null));
    const sections: { key: string; label: string; items: MediaItem[] }[] = [
      ...ordered.map(([b, its]) => ({ key: `r${b}`, label: `${b}★`, items: its })),
      ...(unrated.length ? [{ key: "__unrated__", label: "Unrated", items: unrated }] : []),
    ];
    const nav: [string, string][] = sections.map((s) => [s.key, s.label]);
    return (
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          {sections.map((s) => (
            <div key={s.key} className="scroll-mt-44" ref={(el) => { const m = sectionRefs.current; if (el) m.set(s.key, el); else m.delete(s.key); }}>
              <RatingDivider label={s.label} />
              {view === "list" ? (
                <div className="space-y-2 mb-4 mt-2">
                  {s.items.map((item) => <ListCard key={item.id} item={item} onSelect={onSelect} highlight={highlightId === item.id} />)}
                </div>
              ) : (
                <div className={`${cardGrid} mt-4 mb-2`}>
                  {s.items.map((item) => <PosterCard key={item.id} item={item as PosterCardItem} onSelect={(i) => onSelect(i as MediaItem)} />)}
                </div>
              )}
            </div>
          ))}
        </div>
        {sections.length > 1 && <SectionNav entries={nav} sectionRefs={sectionRefs} />}
      </div>
    );
  }

  // ── NONE (Best match): flat, sorted order preserved, no dividers/nav ──
  if (groupBy === "none") {
    return view === "list" ? (
      <div className="space-y-2">
        {items.map((item) => <ListCard key={item.id} item={item} onSelect={onSelect} highlight={highlightId === item.id} />)}
      </div>
    ) : (
      <div className={cardGrid}>
        {items.map((item) => <PosterCard key={item.id} item={item as PosterCardItem} onSelect={(i) => onSelect(i as MediaItem)} />)}
      </div>
    );
  }

  // ── LIST ─────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          {months.map(([monthKey, dates]) => {
            const ds        = descending ? [...dates].reverse() : dates;
            const firstDate = parseISO(dates[0]);
            const past      = isPast(firstDate) && !isToday(firstDate);
            const current   = isSameMonth(firstDate, new Date());
            return (
              <div
                key={monthKey}
                ref={(el) => { const m = sectionRefs.current; if (el) m.set(monthKey, el); else m.delete(monthKey); }}
                className="scroll-mt-44"
              >
                <MonthDivider label={monthKey} past={past} current={current} />
                {ds.map((dateStr) => (
                  <div key={dateStr} className="scroll-mt-44" ref={(el) => { const m = sectionRefs.current; if (el) m.set(dateStr, el); else m.delete(dateStr); }}>
                    <DayHeader dateStr={dateStr} />
                    <div className="space-y-2 mb-4">
                      {(groups.get(dateStr) ?? []).map((item) => (
                        <ListCard key={item.id} item={item} onSelect={onSelect} highlight={highlightId === item.id} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {noDate.length > 0 && (
            <div className="scroll-mt-44" ref={(el) => { const m = sectionRefs.current; if (el) m.set("__nodate__", el); else m.delete("__nodate__"); }}>
              <MonthDivider label="TBA" past={false} current={false} />
              <div className="space-y-2 mt-4">
                {noDate.map((item) => (
                  <ListCard key={item.id} item={item} onSelect={onSelect} highlight={highlightId === item.id} />
                ))}
              </div>
            </div>
          )}
        </div>
        {showNav && <MonthNav months={months} noDate={noDate} sectionRefs={sectionRefs} />}
      </div>
    );
  }

  // ── CARD ─────────────────────────────────────────────────────
  return (
    <div className="flex gap-2">
      <div className="flex-1 min-w-0">
        {months.map(([monthKey, dates]) => {
          const ds         = descending ? [...dates].reverse() : dates;
          const firstDate  = parseISO(dates[0]);
          const past       = isPast(firstDate) && !isToday(firstDate);
          const current    = isSameMonth(firstDate, new Date());
          const monthItems = ds.flatMap((d) => groups.get(d) ?? []);
          return (
            <div
              key={monthKey}
              className="scroll-mt-44"
              ref={(el) => {
                const m = sectionRefs.current;
                if (el) { if (dates[0]) m.set(dates[0], el); m.set(monthKey, el); }
                else { if (dates[0]) m.delete(dates[0]); m.delete(monthKey); }
              }}
            >
              <MonthDivider label={monthKey} past={past} current={current} />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4 mb-2">
                {monthItems.map((item) => (
                  <PosterCard key={item.id} item={item as PosterCardItem} onSelect={(i) => onSelect(i as MediaItem)} />
                ))}
              </div>
            </div>
          );
        })}
        {noDate.length > 0 && (
          <div className="scroll-mt-44" ref={(el) => { const m = sectionRefs.current; if (el) m.set("__nodate__", el); else m.delete("__nodate__"); }}>
            <MonthDivider label="TBA" past={false} current={false} />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4 mb-2">
              {noDate.map((item) => (
                <PosterCard key={item.id} item={item as PosterCardItem} onSelect={(i) => onSelect(i as MediaItem)} />
              ))}
            </div>
          </div>
        )}
      </div>
      {showNav && <MonthNav months={months} noDate={noDate} sectionRefs={sectionRefs} />}
    </div>
  );
}
