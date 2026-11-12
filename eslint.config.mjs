import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
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
const AUTH_SOURCE = String.raw`/^(@nestjs\/jwt|@bymax-one\/nest-auth)(\/|$)|(^|\/)passport(-[^\/]*)?(\/|$)/`

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      security,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${AUTH_SOURCE}]`, message: AUTH_IMPORT_MESSAGE },
        { selector: `TemplateElement[value.cooked=${AUTH_SOURCE}]`, message: AUTH_IMPORT_MESSAGE },
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
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never',
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
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
      'react-hooks/exhaustive-deps': 'warn',
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
  prettierRecommended,
]
