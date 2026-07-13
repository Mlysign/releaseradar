// S8 — boundary schema validation. One mechanical helper for turning an
// untrusted JSON request body into a validated, typed value. Route-specific
// zod schemas live in `schemas.ts`; this module stays domain-free.
//
// A validation failure throws `BadRequestError`, which `withUser` maps to a
// 400 (see withUser.ts). Routes that don't run inside withUser (pre-session
// auth) catch it themselves or use `badRequest()`.

import { NextResponse } from "next/server";
import { z } from "zod";

/** Thrown when a request body is malformed or fails its schema. → HTTP 400. */
export class BadRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

// Concise, client-safe summary of what failed: field paths + messages only,
// never the offending values (avoids reflecting user input back).
function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/**
 * Parse + validate a JSON request body against a zod schema.
 * - Malformed JSON or a schema mismatch → throws {@link BadRequestError} (→ 400).
 * - `allowEmpty` (for DELETE-style routes that tolerate no body): a missing or
 *   unparseable body becomes `{}` before validation, so an all-optional schema
 *   passes instead of erroring — preserving the old `req.json().catch(() => ({}))`.
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
  opts: { allowEmpty?: boolean } = {},
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    if (opts.allowEmpty) raw = {};
    else throw new BadRequestError("Invalid or missing JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestError(formatIssues(result.error));
  return result.data;
}

/** Standalone 400 for routes outside withUser (e.g. pre-session auth). */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
