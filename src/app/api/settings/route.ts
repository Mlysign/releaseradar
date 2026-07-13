import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { setUserCountry } from "@/lib/userCountry";
import { parseJsonBody } from "@/lib/validate";
import { SettingsPostSchema } from "@/lib/schemas";

// Profile settings writes (T22). Currently just the country that drives
// region-aware release dates + streaming availability.
export const POST = withUser(async (req: NextRequest, session) => {
  const { country: countryInput } = await parseJsonBody(req, SettingsPostSchema);
  const country = setUserCountry(session.userId, countryInput);
  if (!country) return NextResponse.json({ error: "Unknown country code" }, { status: 400 });
  return NextResponse.json({ ok: true, country });
});
