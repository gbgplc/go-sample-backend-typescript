import { NextRequest, NextResponse } from 'next/server';
import { marketConfig } from '@/lib/config';

export function middleware(request: NextRequest): NextResponse {
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
