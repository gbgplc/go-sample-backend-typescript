import { NextRequest } from 'next/server';
import { sessionConfig } from '@/lib/config';
import { OnboardingException } from '@/lib/errors/onboardingException';
import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

/**
 * Multipart upload for proof of address, power of attorney, etc. Returns a
 * reference to include in the next interaction submission. Document/selfie
 * capture stays a placeholder pending a capture SDK choice.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw OnboardingException.validationFailed('That image could not be read. Try again.');
    }
    const content = Buffer.from(await file.arrayBuffer());

    const result = await sessionService.uploadAttachment(params.id, cookieToken, content);
    return jsonResponse(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
