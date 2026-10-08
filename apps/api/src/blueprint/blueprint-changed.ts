import { ConflictException } from '@nestjs/common';

/** 409 for a write based on a saved version that is no longer current; the web
 * canvas reads `code` and `currentVersionId` to offer loading the newer save. */
export function blueprintChanged(currentVersionId: string | null) {
  return new ConflictException({
    code: 'blueprint_changed',
    message: 'This blueprint was saved elsewhere since this page loaded.',
    currentVersionId,
  });
}
