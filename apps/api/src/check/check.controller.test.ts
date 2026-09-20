import { describe, expect, it } from 'vitest';
import { CheckController } from './check.controller';
import { BUILTIN_CHECKS } from './builtins/index';

describe('CheckController.listCheckTypes', () => {
  it('returns every BUILTIN_CHECKS entry plus the script entry', () => {
    const controller = new CheckController();
    const types = controller.listCheckTypes();

    const builtinKeys = Object.keys(BUILTIN_CHECKS);
    expect(types).toHaveLength(builtinKeys.length + 1);

    for (const key of builtinKeys) {
      const check = BUILTIN_CHECKS[key]!;
      expect(types).toContainEqual({
        key: check.key,
        kind: 'builtin',
        paramsSchema: check.paramsSchema,
        description: check.description,
      });
    }

    const script = types.find((t) => t.kind === 'script');
    expect(script).toMatchObject({ key: 'script', kind: 'script' });
    expect(script && 'paramsSchema' in script).toBe(false);
  });
});
