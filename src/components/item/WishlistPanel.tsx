"use client";
import Link from "next/link";
import { SOURCE_COLORS } from "@/lib/constants";

// Per-provider wishlist management ("Your wishlists") on the item detail page.
export default function WishlistPanel({
  platforms, loading, platformAction, onToggle, steamStoreUrl,
}: {
  platforms: any[];
  loading: boolean;
  platformAction: string | null;
  onToggle: (provider: string, onList: boolean) => void;
  steamStoreUrl: string | null;
}) {
  return (
    <div className="pt-4 border-t border-neutral-800/60">
      <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Your wishlists</p>
      {loading ? (
        <p className="text-xs text-neutral-600">Loading…</p>
      ) : (
        <div className="space-y-2">
          {platforms.map((p) => {
            const color = SOURCE_COLORS[p.provider] ?? "#888";
            return (
              <div key={p.provider} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-sm text-neutral-300">{p.label}</span>
                  {p.displayName && <span className="text-xs text-neutral-600">@{p.displayName}</span>}
                </div>
                {p.notConnected ? (
                  <Link href="/settings" className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Not connected →</Link>
                ) : p.provider === "steam" ? (
                  <div className="flex items-center gap-2">
                    {p.onList && <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: color + "44", color, background: color + "15" }}>✓ On wishlist</span>}
                    {steamStoreUrl ? (
                      <a href={steamStoreUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                        {p.onList ? "Open on Steam →" : "View on Steam →"}
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-600">Read-only</span>
                    )}
                  </div>
                ) : p.onList ? (
                  <button onClick={() => onToggle(p.provider, true)} disabled={platformAction === p.provider} className="text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40" style={{ borderColor: color + "44", color, background: color + "15" }}>
                    {platformAction === p.provider ? "..." : "✓ On list – Remove"}
                  </button>
                ) : (
                  <button onClick={() => onToggle(p.provider, false)} disabled={platformAction === p.provider} className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40">
                    {platformAction === p.provider ? "..." : "+ Add to list"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
