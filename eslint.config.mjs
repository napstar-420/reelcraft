// @ts-check
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', '**/drizzle/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/shared/**/*.ts'],
    plugins: { import: importPlugin },
    rules: {
      // §1.1 — packages/shared imports nothing from apps/*, and performs no I/O.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**'],
              message: 'packages/shared must not import from apps/* (§1.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/capability/**/*.ts'],
    rules: {
      // §1.3 — CapabilityModule may not reach DbModule, RunModule, or
      // BlueprintModule. Enforced primarily by DI (DbModule is not
      // @Global()); this catches an accidental import at lint time too.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/**', '**/run/**', '**/blueprint/**'],
              message:
                'CapabilityModule may not import DbModule, RunModule, or BlueprintModule (§1.3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Standalone build-tool config files (drizzle/vite/vitest) aren't
          // included by any app's own tsconfig.json — without this,
          // typescript-eslint's project service can't find a tsconfig
          // covering them and fails to parse them at all.
          allowDefaultProject: ['*.config.ts', 'apps/*/*.config.ts', 'packages/*/*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  prettierConfig,
);
