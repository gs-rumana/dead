import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'tools/e2e/out/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // The simulation core stays transport-free (§6.5); only sim/host may touch the schema layer.
    files: ['packages/sim/src/**/*.ts'],
    ignores: ['packages/sim/src/host/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@colyseus/*', 'colyseus'],
              message: 'packages/sim must not depend on Colyseus.',
            },
          ],
        },
      ],
    },
  },
  {
    // World generation must be deterministic (§6.6).
    files: ['packages/shared/src/worldgen/**/*.ts', 'packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded Rng from @dead-tracks/shared.',
        },
      ],
    },
  },
);
