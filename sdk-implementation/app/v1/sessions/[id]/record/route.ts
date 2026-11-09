import { NextRequest } from 'next/server';
import { withSession } from '@/lib/http/withSession';
import { sessionService } from '@/lib/session/sessionService';

/**
 * The verification record for the final screen — journey name and version,
 * reference, timestamps, elapsed time, per-module outcome, and the deciding
 * module where the outcome wasn't a straight pass.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withSession(request, (cookieToken) => sessionService.getRecord(params.id, cookieToken));
}
