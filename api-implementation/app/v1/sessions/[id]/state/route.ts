import { NextRequest } from 'next/server';
import { withSession } from '@/lib/http/withSession';
import { sessionService } from '@/lib/session/sessionService';

/** Journey status and, once reached, the decision. Polled while a processing screen is showing. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withSession(request, (cookieToken) => sessionService.getState(params.id, cookieToken));
}
