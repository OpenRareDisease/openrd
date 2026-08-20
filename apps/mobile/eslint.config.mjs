import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginImport from 'eslint-plugin-import';
import { defineConfig } from 'eslint/config';

/**
 * Lint config for the mobile app.
 *
 * A note on what this used to miss
 * -------------------------------
 * `npm run lint` ran `expo lint`, whose default inputs are `src/`,
 * `app/` and `components/`. This project keeps almost everything in
 * `screens/` (68 files) and `lib/`, neither of which is on that list —
 * so the command reported success while never opening two thirds of the
 * codebase. `app/` holds seven thin route files and those really were
 * clean, which is what made it convincing. The script now calls eslint
 * on the project root instead.
 *
 * The plugins below are here for the same reason. The code carried
 * `eslint-disable-next-line react-hooks/exhaustive-deps` and
 * `import/first` comments for rules that were never configured, so
 * those disables suppressed nothing and the rules they named had never
 * run. A disable comment for an unconfigured rule is itself an error
 * (`Definition for rule ... was not found`), which is how they surfaced
 * the moment the whole tree was linted.
 */
export default defineConfig([
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.expo/**'] },

  { files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'], plugins: { js }, extends: ['js/recommended'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat['jsx-runtime'],

  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { 'react-hooks': pluginReactHooks, import: pluginImport },
    rules: {
      // Deliberately not `configs.recommended`. v7 ships the React
      // Compiler-era rules (set-state-in-effect, refs, immutability),
      // which flag twenty long-standing patterns here — loading data in
      // an effect, mutating a shared value in a press handler. Whether
      // to adopt those is a real decision with a refactor attached, and
      // it is not this change's to make. These two are the classic
      // pair: one catches genuine bugs, the other is the rule the
      // codebase already had a disable comment for.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import/first': 'error',
    },
    settings: { react: { version: 'detect' } },
  },

  // Build tooling runs in Node, not in the app. Without this the shared
  // browser globals above leave `require`, `module` and `__dirname`
  // reading as undefined.
  {
    files: ['*.config.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Jest test environments run in the RUNNER's realm, not in the app
  // and not inside a test file: they are CommonJS modules jest loads
  // itself, so `require`, `module` and `process` are the only way to
  // write one. Kept out of `__tests__/` because jest's default
  // `testMatch` treats every file under that directory as a suite and
  // fails an environment for containing no tests.
  {
    files: ['test-support/**/*.{js,cjs}'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Jest module mocking is `require`-based by construction: the factory
  // has to run after `jest.mock` hoisting, which an ESM import cannot
  // do — so both rules are wrong here rather than the code being wrong.
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
    },
  },
]);
