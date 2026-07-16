import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { BASE_URL } from "@/lib/baseUrl";
import { isPublicType, isUuid, slugify } from "@/lib/publicUrl";
import { loadPublicDetail, PublicItem } from "@/lib/detail/publicDetail";
import { ScoreBadge, Fact } from "@/components/item/primitives";
import { fmtDate } from "@/components/item/format";

// P13 — the public, server-rendered detail page: `/{type}/{uuid}/{slug}`.
//
// Server-rendered so the HTML carries the real content. That is the whole point:
// crawlers and link unfurlers (WhatsApp/Discord/Slack/iMessage) do NOT run our
// JavaScript, so the client-rendered /item page shows them an empty shell. Here
// the title, description and poster are in the markup on first byte.
//
// PUBLIC = CATALOG ONLY. Everything on this page comes from loadPublicDetail,
// whose type cannot carry the viewer's rating/review/status (see that module).
// Rating, wishlist and "mark watched" live in the authed /item page — an
// anonymous reader has nothing to act with, so none of it is rendered here.

interface Params {
  type: string;
  id: string;
  slug: string;
}

// Resolve + validate once; both generateMetadata and the page call this, and
// React dedupes it within a request so it's a single DB read either way.
function resolve(type: string, id: string): PublicItem | null {
  if (!isPublicType(type) || !isUuid(id)) return null;
  const item = loadPublicDetail(id);
  // The type segment must match the item's real type, so /game/<movie-uuid>/x
  // 404s instead of rendering a movie under a game URL (two URLs, one item =
  // duplicate content, and a nonsense breadcrumb).
  if (!item || item.type !== type) return null;
  return item;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  // `slug` is deliberately ignored here — the canonical below always rebuilds it
  // from the current title, so every slug variant reports one canonical URL.
  const { type, id } = await params;
  const item = resolve(type, id);
  if (!item) return { title: "Not found", robots: { index: false, follow: false } };

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const title = year ? `${item.title} (${year})` : item.title;
  const description =
    item.description?.slice(0, 200) ??
    `${item.title} — release date, ratings and where to watch, on Fandex.`;
  // Canonical always points at the CURRENT slug, so the stale-slug and
  // wrong-slug variants of this URL consolidate into one indexed page.
  const canonical = `${BASE_URL}/${type}/${id}/${slugify(item.title)}`;
  const image = item.posterUrl ?? item.backdropUrl;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: image ? [{ url: image, alt: item.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PublicItemPage({ params }: { params: Promise<Params> }) {
  const { type, id, slug } = await params;
  const item = resolve(type, id);
  if (!item) notFound();

  // The slug is cosmetic — the UUID already resolved the item — but a wrong or
  // outdated one redirects to the canonical form, so a retitled item's old links
  // keep working AND search engines see a single URL per item.
  //
  // PERMANENT (308), not redirect()'s default 307: a temporary redirect tells
  // Google to keep indexing both URLs, which is duplicate content and splits any
  // link equity. 308 consolidates them onto the canonical slug.
  const canonicalSlug = slugify(item.title);
  if (slug !== canonicalSlug) permanentRedirect(`/${type}/${id}/${canonicalSlug}`);

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const image = item.posterUrl ?? item.backdropUrl;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex flex-col sm:flex-row gap-8">
          {image && (
            // Raw <img>: these are remote CDN posters and the page is public +
            // cacheable — no per-request optimization round trip needed.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={item.title}
              width={256}
              height={384}
              className="w-48 sm:w-64 rounded-xl shadow-lg self-start"
            />
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {item.title}
              {year && <span className="ml-2 font-normal text-neutral-500">({year})</span>}
            </h1>

            {item.tagline && <p className="mt-2 text-neutral-400 italic">{item.tagline}</p>}

            {item.communityRatings.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.communityRatings.map((r) => (
                  <ScoreBadge key={r.source} r={r} />
                ))}
              </div>
            )}

            {item.description && (
              <p className="mt-5 text-neutral-300 leading-relaxed">{item.description}</p>
            )}

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {item.releaseDate && <Fact label="Released">{fmtDate(item.releaseDate)}</Fact>}
              {item.runtimeMinutes && <Fact label="Runtime">{item.runtimeMinutes} min</Fact>}
              {item.status && <Fact label="Status">{item.status}</Fact>}
              {item.collection && <Fact label="Collection">{item.collection}</Fact>}
              {item.certification.length > 0 && <Fact label="Rated">{item.certification.join(" · ")}</Fact>}
              {item.platforms.length > 0 && <Fact label="Platforms">{item.platforms.join(", ")}</Fact>}
            </div>

            {item.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {item.tags.slice(0, 12).map((t) => (
                  <span key={t} className="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-300 text-xs">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* The one call to action an anonymous reader can actually take. */}
            <div className="mt-8">
              <Link
                href="/"
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
              >
                Track this on Fandex
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
