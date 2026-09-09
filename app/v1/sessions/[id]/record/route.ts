import { NextRequest } from 'next/server';
import { sessionConfig } from '@/lib/config';
import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

/**
 * The verification record for the final screen — journey name and version,
 * reference, timestamps, elapsed time, per-module outcome, and the deciding
 * module where the outcome wasn't a straight pass.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;
    const record = await sessionService.getRecord(params.id, cookieToken);
    return jsonResponse(record);
  } catch (err) {
    return handleRouteError(err);
  }
}
