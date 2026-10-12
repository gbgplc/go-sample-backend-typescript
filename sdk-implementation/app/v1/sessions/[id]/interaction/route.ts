import { NextRequest } from 'next/server';
import { SubmitInteractionRequest } from '@/lib/dto/types';
import { ValidationError } from '@/lib/http/errorHandling';
import { withSession } from '@/lib/http/withSession';
import { sessionService } from '@/lib/session/sessionService';

interface RouteParams {
  params: { id: string };
}

/** Re-fetches whichever interaction the session is currently on — the front end's routing signal for which screen to render. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withSession(request, (cookieToken) => sessionService.getInteraction(params.id, cookieToken));
}

/**
 * Idempotent on interactionId — resubmitting the same one returns the
 * cached result rather than advancing twice. Returns the next interaction,
 * or a terminal status.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withSession(request, async (cookieToken) => {
    let body: SubmitInteractionRequest;
    try {
      body = (await request.json()) as SubmitInteractionRequest;
    } catch {
      throw new ValidationError({ body: 'must be valid JSON' });
    }
    if (!body.interactionId || body.interactionId.trim() === '') {
      throw new ValidationError({ interactionId: 'must not be blank' });
    }
    return sessionService.submitInteraction(params.id, cookieToken, body.interactionId, body.data);
  });
}
