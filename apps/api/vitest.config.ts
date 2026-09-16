import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Nest's DI relies on `reflect-metadata` + `emitDecoratorMetadata`, which
 * esbuild (vitest's default transform) doesn't support — swc does, so unit
 * tests run through it instead. `module: 'es6'` is deliberate even though
 * the app itself builds to CommonJS (tsconfig.base.json): vitest runs
 * every file through Vite's own ESM module graph regardless of the app's
 * `tsc`/`nest build` output target, and vitest's own package is ESM-only —
 * transforming test files to CommonJS breaks `import { describe } from
 * 'vitest'`. This only affects how vitest loads/transforms files at test
 * time, not what `nest build` emits.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
