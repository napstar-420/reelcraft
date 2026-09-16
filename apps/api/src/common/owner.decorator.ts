import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * REQ-17.3 / §21 — multi-tenant seam. Always resolves to 'local' in v1, but
 * every controller takes it from day one so the seam is threaded through
 * rather than retrofitted.
 */
export const Owner = createParamDecorator((_data: unknown, _ctx: ExecutionContext): string => {
  return 'local';
});
