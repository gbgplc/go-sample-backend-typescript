import { NextRequest, NextResponse } from 'next/server';
import { ErrorEnvelope } from '@/lib/dto/types';
import { jsonResponse } from '@/lib/http/jsonResponse';

/**
 * `@/lib/config` fails fast at module load on a bad MARKET or a malformed
 * screen-plan stage (see lib/config/index.ts) — deliberately, so a broken
 * deployment never starts serving traffic. Middleware runs ahead of every
 * route handler's own try/catch though, so a static import here would let
 * that throw surface as a raw framework error instead of this app's
 * ErrorEnvelope JSON shape. Resolving it via a (cached-after-first-success)
 * dynamic import lets this one call site catch it and degrade in-contract.
 */
async function resolveMarketConfigForMiddleware(): Promise<{ app: { corsAllowedOrigins: string[] } } | undefined> {
  try {
    return (await import('@/lib/config')).marketConfig;
  } catch (err) {
    console.error('Unhandled exception resolving market config', err);
    return undefined;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const marketConfig = await resolveMarketConfigForMiddleware();
  if (!marketConfig) {
    const body: ErrorEnvelope = {
      code: 'UPSTREAM_UNAVAILABLE',
      http: 500,
      message: 'Something went wrong on our end. Try again shortly.',
      retryable: true,
    };
    return jsonResponse(body, 500);
  }

  const origin = request.headers.get('origin');
  const allowed = Boolean(origin && marketConfig.app.corsAllowedOrigins.includes(origin));

  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    if (allowed && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST');
      response.headers.set(
        'Access-Control-Allow-Headers',
        request.headers.get('access-control-request-headers') ?? 'Content-Type'
      );
    }
    return response;
  }

  const response = NextResponse.next();
  if (allowed && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
}

export const config = {
  matcher: '/v1/:path*',
};
