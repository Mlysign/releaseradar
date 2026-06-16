"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import InsightsView from "@/components/insights/InsightsView";
import { InsightsPayload } from "@/components/insights/types";

type Status = "loading" | "ready" | "empty" | "error";

export default function InsightsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<InsightsPayload | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const me = await fetch("/api/auth/me");
    const meData = await me.json();
    if (!meData.user) { router.push("/"); return; }
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) throw new Error("request failed");
      const d: InsightsPayload = await res.json();
      if (!d.overview || d.overview.ratedTotal === 0) { setStatus("empty"); return; }
      setData(d);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Library insights</h1>
          <p className="text-sm text-neutral-500">What your ratings reveal about your taste — tags, people, studios and more.</p>
        </div>

        {status === "loading" && <div className="text-center py-20 text-neutral-500">Analyzing your library…</div>}
        {status === "error" && (
          <div className="text-center py-20 text-neutral-500">
            <p className="mb-3">Couldn&apos;t load your insights.</p>
            <button onClick={init} className="text-xs underline text-neutral-400">Try again</button>
          </div>
        )}
        {status === "empty" && (
          <div className="text-center py-20 text-neutral-500">
            <p className="mb-1">No rated items in your library yet.</p>
            <p className="text-xs">Rate a few games, movies or shows, then come back — every chart here is built from your ratings. <Link href="/library" className="underline hover:text-white">Go to Library →</Link></p>
          </div>
        )}
        {status === "ready" && data && <InsightsView data={data} />}
      </main>
    </div>
  );
}
