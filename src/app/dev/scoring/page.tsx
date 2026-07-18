import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isScoringAdmin } from "@/lib/devAdmin";
import ScoringAdmin from "./ScoringAdmin";

// H5.4 D5 — env user-ID allowlist gate. A non-admin (or logged-out visitor)
// gets a plain 404, same as any nonexistent route — this page's existence
// isn't something to advertise.
export default async function DevScoringPage() {
  const session = await getSession();
  if (!session || !isScoringAdmin(session.userId)) notFound();
  return <ScoringAdmin />;
}
