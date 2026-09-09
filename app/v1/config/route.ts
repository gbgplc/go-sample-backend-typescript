import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

/**
 * Brand name, accent colour, help contact, journey name and resource ID —
 * keeps brand values out of the front-end bundle so a deployment can be
 * re-pointed without a rebuild. No cookie required.
 */
export async function GET() {
  try {
    return jsonResponse(sessionService.getConfig());
  } catch (err) {
    return handleRouteError(err);
  }
}
