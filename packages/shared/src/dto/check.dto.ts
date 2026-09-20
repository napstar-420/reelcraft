import { z } from 'zod';
import { CheckDef } from '../check';

/** Backs `POST /checks/test` — lets an editor try a builtin or script check
 * against a real artifact from a past run before wiring it into a
 * blueprint's `checks[]`. */
export const TestCheckRequestDto = z.object({
  check: CheckDef,
  artifactId: z.string(),
});
export type TestCheckRequestDto = z.infer<typeof TestCheckRequestDto>;
