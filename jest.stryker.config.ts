import type { Config } from 'jest'

/**
 * Jest configuration used by the Stryker mutation runner. Coverage collection is
 * disabled — Stryker performs its own per-test coverage analysis. Kept
 * self-contained so the TypeScript config loads under native ESM resolution.
 */
/** Mapping shared by both projects: the package's own specifiers resolve to source. */
const moduleNameMapper = {
  '^@bymax-one/nest-realtime$': '<rootDir>/server/index.ts',
  '^@bymax-one/nest-realtime/internal$': '<rootDir>/internal/index.ts',
  '^@bymax-one/nest-realtime/shared$': '<rootDir>/shared/index.ts',
  '^@bymax-one/nest-realtime/react$': '<rootDir>/react/index.ts',
}

const config: Config = {
  rootDir: 'src',
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
  collectCoverage: false,
  projects: [
    {
      displayName: 'server',
      rootDir: 'src',
      /**
       * `test/` must be listed explicitly. `rootDir` is `src`, and Jest defaults `roots`
       * to `[rootDir]` — a spec importing a harness from `test/fixtures/` then falls
       * outside the scope Stryker's `perTest` coverage analysis tracks, so the mutants
       * that harness's tests exercise are attributed to the wrong tests and survive.
       * The failure is silent: the suite stays green and only the mutation score drops.
       * Measured on the SSE subscription handler — 12.28 tests per mutant with this
       * line, 8.89 without, and the score falls from 100 to 67.
       */
      roots: ['<rootDir>', '<rootDir>/../test'],
      testEnvironment: 'node',
      moduleFileExtensions: ['ts', 'js', 'json'],
      testRegex: '^(?!.*[\\\\/]react[\\\\/]).*\\.spec\\.ts$',
      setupFiles: ['reflect-metadata'],
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          { tsconfig: '<rootDir>/../tsconfig.jest.json', isolatedModules: true },
        ],
      },
      moduleNameMapper,
    },
    {
      displayName: 'react',
      rootDir: 'src',
      roots: ['<rootDir>', '<rootDir>/../test'],
      testEnvironment: 'jsdom',
      moduleFileExtensions: ['tsx', 'ts', 'js', 'json'],
      testRegex: '[\\\\/]react[\\\\/].*\\.spec\\.tsx?$',
      setupFilesAfterEnv: ['<rootDir>/../test/setup/react-setup.ts'],
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          { tsconfig: '<rootDir>/../tsconfig.jest.json', isolatedModules: true },
        ],
      },
      moduleNameMapper,
    },
  ],
}

export default config
