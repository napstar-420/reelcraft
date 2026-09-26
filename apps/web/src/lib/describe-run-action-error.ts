import { ApiError } from '@/api/client';

/** Surfaces the server's actual rejection message (e.g. a `ConflictException`
 * like "Action retry is not allowed while run is COMPLETED") rather than the
 * generic "POST /path failed: 409" `ApiError.message` — client-side action
 * gating (`run-action-policy.ts`) is only a UX nicety, so a stale click can
 * still reach the server and needs a legible reason why it was rejected. */
export function describeRunActionError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const issues = error.issues;
    if (
      issues &&
      typeof issues === 'object' &&
      'message' in issues &&
      typeof (issues as { message: unknown }).message === 'string'
    ) {
      return (issues as { message: string }).message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
