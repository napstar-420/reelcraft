import { ApiError } from '@/api/client';

/** The API's own error message (Nest's `message` field), else `fallback`. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const issues = error.issues as { message?: unknown } | unknown[] | undefined;
    if (Array.isArray(issues)) {
      const first = issues[0] as { message?: unknown } | undefined;
      if (typeof first?.message === 'string') return first.message;
    } else if (typeof issues?.message === 'string') {
      return issues.message;
    }
  }
  return fallback;
}
