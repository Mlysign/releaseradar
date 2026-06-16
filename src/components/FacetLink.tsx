"use client";
import Link from "next/link";
import { buildFacetHref } from "@/lib/itemUrl";
import { personKey, companyKey, tagKey } from "@/lib/facets";

// T7: a tag / person / company label that links to its facet detail page. Computes
// the normalized facet key the same way the server does, so the link resolves.

type FacetKind = "tag" | "person" | "company";

export function facetHref(kind: FacetKind, role: string | undefined, label: string): string {
  const key = kind === "person" ? personKey(label) : kind === "company" ? companyKey(label) : tagKey(label);
  return buildFacetHref({ kind, role, key, label });
}

export default function FacetLink({
  kind, role, label, className, style,
}: { kind: FacetKind; role?: string; label: string; className?: string; style?: React.CSSProperties }) {
  return <Link href={facetHref(kind, role, label)} className={className} style={style}>{label}</Link>;
}
