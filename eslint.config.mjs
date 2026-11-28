import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importPlugin from 'eslint-plugin-import-x'
import security from 'eslint-plugin-security'
import reactHooks from 'eslint-plugin-react-hooks'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

// The library never imports an authentication package: the consumer plugs IConnectionAuthenticator.
// A module can be named by a string in any call shape (`import`, `import()`, `require()`,
// `module.require()`, a type-level `import()`), so the rule matches the string itself, wherever a
// string literal or a template quasi equals one of these specifiers, and not the syntax around it.
// A specifier assembled at run time is invisible to any lint rule, so this covers literals only.
const AUTH_IMPORT_MESSAGE =
  'This library never imports an auth package: the consumer plugs IConnectionAuthenticator.'
// `for await` asks its operand for `Symbol.asyncIterator` and then for `next`, on whatever the host handed over, and those
// are looked up on prototypes a host can replace; a decision reads with an explicit, shielded await instead.
const FOR_AWAIT_MESSAGE =
  'for await reads Symbol.asyncIterator and next from a host value: await each step explicitly.'
const AUTH_SOURCE = String.raw`/^(@nestjs\/jwt|@bymax-one\/nest-auth)(\/|$)|(^|\/)passport(-[^\/]*)?(\/|$)/`

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.ts', 'test/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import-x': importPlugin,
      security,
    },
    settings: {
      // Without the TypeScript settings the plugin does not parse an imported `.ts` file, and
      // `no-cycle` sees no edge to follow.
      ...importPlugin.flatConfigs.typescript.settings,
      'import-x/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${AUTH_SOURCE}]`, message: AUTH_IMPORT_MESSAGE },
        { selector: `TemplateElement[value.cooked=${AUTH_SOURCE}]`, message: AUTH_IMPORT_MESSAGE },
        { selector: 'ForOfStatement[await=true]', message: FOR_AWAIT_MESSAGE },
      ],
      ...(security.configs?.recommended?.rules ?? {}),
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never',
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-cycle': 'error',
      // Map/object index access is pervasive in the internal registries and is not
      // user-controlled object injection; the noisy heuristic is disabled in favor
      // of the type system and targeted review.
      'security/detect-object-injection': 'off',
    },
  },
  {
    // React hooks rules only apply to the browser subpath.
    files: ['src/react/**/*.ts', 'src/react/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // The shared subpath is strictly zero-dependency: no runtime imports allowed.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@nestjs'],
              message: 'src/shared is zero-dependency: no @nestjs imports.',
            },
            {
              group: ['rxjs', 'rxjs/*'],
              message: 'src/shared is zero-dependency: no rxjs imports.',
            },
            {
              group: ['socket.io', 'socket.io-client', 'socket.io/*'],
              message: 'src/shared is zero-dependency: no socket.io imports.',
            },
          ],
        },
      ],
    },
  },
  // A function is at most 50 raw lines: blank lines and comments count, as a reader sees them, and an
  // IIFE is a function. Spec files are exempt, since a `describe` callback holds a whole suite.
  //
  // The functions that were already longer when the rule was added are recorded in
  // `eslint-suppressions.json`, ESLint's own bulk-suppression file, so the rule fails on what a change
  // introduces and not on what the repository inherits. Neither `pnpm lint` nor CI passes
  // `--pass-on-unpruned-suppressions`, so a suppression that no longer matches a violation (a split
  // function) fails until it is removed with `eslint --prune-suppressions`. ESLint does not stop the file
  // from being regenerated with `--suppress-rule` after a new violation, so CI runs `check:suppressions`
  // against the baseline a pull request is based on, or a push replaced: a count that rose, or an entry
  // that revision lacks, fails.
  //
  // A suppression counts violations per file and rule, not per function. A new offender in a file that
  // still has suppressions is reported only when it raises that file's count, so a split and a new
  // offender in the same file net to zero and go unseen. The count can only go down, which is why this is
  // accepted, but it is not invisible: a split removes its suppression in the same change.
  // The baseline is keyed by file, so a function moved to another file counts as growth there and fails
  // `check:suppressions`: a move has to fix the violation and not carry it along.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/*.spec.ts', '**/*.spec.tsx'],
    // An `eslint-disable` comment would otherwise accept a long function without touching the baseline.
    linterOptions: { noInlineConfig: true },
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: false, skipComments: false, IIFEs: true },
      ],
    },
  },
  // Node.js scripts: plain ESM, no TypeScript parser needed.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: { security },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'security/detect-object-injection': 'warn',
    },
  },
  prettierRecommended,
]
