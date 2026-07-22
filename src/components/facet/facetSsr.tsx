import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { isFacetPrefix, prefixToKind, slugToKey, publicFacetHref, FacetPrefix } from "@/lib/facetUrl";
import { canonicalTagKey } from "@/lib/tagAlias";
import { buildPublicFacetDetail, isFacetSort, FacetSort, PublicFacetPayload } from "@/lib/detail/publicFacetDetail";
import { getSession } from "@/lib/session";
import PublicFacetView from "@/components/facet/PublicFacetView";

// P17 — shared SSR for the three public facet routes (/person, /tag, /studio).
// Each route is a thin wrapper that pins its prefix; everything else lives here.

const ROLE_LABEL: Record<FacetPrefix, string> = { person: "Person", tag: "Tag", studio: "Studio" };

// cache() dedupes the provider build across generateMetadata + the render (both
// need the payload). Keyed by (prefix, slug, sort) so metadata and body — which
// pass the SAME sort from searchParams — resolve to one build per request. The
// session doesn't need to be in this key: it can't change mid-request, so both
// callers see the same persist decision regardless of which one runs first.
const resolve = cache(async (prefix: string, slug: string, sort: FacetSort): Promise<PublicFacetPayload | null> => {
  if (!isFacetPrefix(prefix)) return null;
  let key = slugToKey(slug);
  if (!key) return null;
  // H5.6: a tag bundle's member spellings resolve to the canonical key, so the
  // provider pool + metadata use the canonical (the body separately 308s the URL).
  if (prefix === "tag") key = canonicalTagKey(key);
  // PR14: only a real session earns a write. cookies() is readable (though not
  // writable) from a Server Component, so this is safe to call from metadata
  // generation too — see @/lib/session.
  const session = await getSession();
  return buildPublicFacetDetail({ kind: prefixToKind(prefix), key }, { page: 0, sort, persist: !!session });
});

function sortOf(sp: Record<string, string | string[] | undefined> | undefined): FacetSort {
  const s = sp?.sort;
  const v = Array.isArray(s) ? s[0] : s;
  return isFacetSort(v) ? v : "popular";
}

export async function buildFacetMetadata(
  prefix: FacetPrefix,
  slug: string,
  searchParams?: Record<string, string | string[] | undefined>
): Promise<Metadata> {
  const found = await resolve(prefix, slug, sortOf(searchParams));
  if (!found || (found.total === 0 && !found.person)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const label = found.label;
  const description =
    prefix === "person" ? `Every movie & show ${label} worked on, with ratings and where to watch — on Fandex.`
    : prefix === "studio" ? `Movies, shows and games from ${label}, ranked by rating — on Fandex.`
    : `The best ${label} movies, shows and games, ranked — on Fandex.`;
  const canonical = `${BASE_URL}${publicFacetHref({ kind: found.kind, key: found.key })}`;

  return {
    title: label,
    description,
    ...(PUBLIC_ITEMS_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical },
    openGraph: { title: label, description, url: canonical, type: "website", images: found.person?.profileUrl ? [{ url: found.person.profileUrl, alt: label }] : undefined },
    twitter: { card: "summary", title: label, description },
  };
}

export async function FacetPageBody({
  prefix, slug, searchParams,
}: { prefix: FacetPrefix; slug: string; searchParams?: Record<string, string | string[] | undefined> }) {
  // H5.6: 308 a bundled member spelling to its canonical url so the whole bundle
  // lives at one address. Only tags have aliases; person/studio pass through.
  if (prefix === "tag") {
    const key = slugToKey(slug);
    const canonical = canonicalTagKey(key);
    if (canonical && canonical !== key) permanentRedirect(publicFacetHref({ kind: "tag", key: canonical }));
  }
  const sort = sortOf(searchParams);
  const found = await resolve(prefix, slug, sort);
  if (!found || (found.total === 0 && !found.person)) notFound();
  return <PublicFacetView initial={found} prefix={prefix} kind={found.kind} roleLabel={ROLE_LABEL[prefix]} />;
}
