import { NextRequest } from 'next/server';
import { OnboardingException } from '@/lib/errors/onboardingException';
import { withSession } from '@/lib/http/withSession';
import { sessionService } from '@/lib/session/sessionService';

/**
 * Multipart upload for proof of address, power of attorney, etc. Returns a
 * reference to include in the next interaction submission. Document/selfie
 * capture stays a placeholder pending a capture SDK choice.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withSession(request, async (cookieToken) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw OnboardingException.validationFailed('That image could not be read. Try again.');
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw OnboardingException.validationFailed('That image could not be read. Try again.');
    }
    const content = Buffer.from(await file.arrayBuffer());
    return sessionService.uploadAttachment(params.id, cookieToken, content);
  });
}
