import { NextResponse } from 'next/server';

/**
 * Recursively strips `null`/`undefined` keys, mirroring Jackson's
 * `non_null` inclusion on the Java side — the wire contract never sends an
 * explicit null, so a field is either present with a value or absent
 * entirely. Applied centrally here rather than trusting every call site to
 * avoid setting nulls.
 */
function omitNullish(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitNullish);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[key] = omitNullish(v);
    }
    return out;
  }
  return value;
}

export function jsonResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(omitNullish(data), { status });
}
