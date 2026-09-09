import { NextRequest } from 'next/server';
import { sessionConfig } from '@/lib/config';
import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

/** Journey status and, once reached, the decision. Polled while a processing screen is showing. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;
    const state = await sessionService.getState(params.id, cookieToken);
    return jsonResponse(state);
  } catch (err) {
    return handleRouteError(err);
  }
}
