import { NextRequest } from 'next/server';
import { sessionConfig } from '@/lib/config';
import { SubmitInteractionRequest } from '@/lib/dto/types';
import { handleRouteError, ValidationError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

interface RouteParams {
  params: { id: string };
}

/** Re-fetches whichever interaction the session is currently on — the front end's routing signal for which screen to render. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;
    const interaction = await sessionService.getInteraction(params.id, cookieToken);
    return jsonResponse(interaction);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Idempotent on interactionId — resubmitting the same one returns the
 * cached result rather than advancing twice. Returns the next interaction,
 * or a terminal status.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;
    const body = (await request.json()) as SubmitInteractionRequest;
    if (!body.interactionId || body.interactionId.trim() === '') {
      throw new ValidationError({ interactionId: 'must not be blank' });
    }
    const result = await sessionService.submitInteraction(params.id, cookieToken, body.interactionId, body.data);
    return jsonResponse(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
