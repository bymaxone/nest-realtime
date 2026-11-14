import type { Config } from 'jest'

/**
 * Jest configuration used by the Stryker mutation runner. Coverage collection is
 * disabled — Stryker performs its own per-test coverage analysis. Kept
 * self-contained so the TypeScript config loads under native ESM resolution.
 */
const config: Config = {
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
  /**
   * Stryker's Jest runner runs one flat configuration and does not honour `projects`, so the
   * environment is chosen per test file: jsdom for a spec under `react/`, node for the rest.
   * Stryker resolves this path itself, without Jest's `<rootDir>` substitution, so it is built
   * from the working directory, which is the repository root for both Jest and Stryker.
   */
  testEnvironment: `${process.cwd()}/test/setup/stryker-environment.cjs`,
  moduleFileExtensions: ['tsx', 'ts', 'js', 'json'],
  testRegex: '.*\\.spec\\.tsx?$',
  setupFiles: ['reflect-metadata', '<rootDir>/../test/setup/jest.loopback-listen.ts'],
  setupFilesAfterEnv: ['<rootDir>/../test/setup/stryker-react-setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.jest.json', isolatedModules: true },
    ],
  },
  moduleNameMapper: {
    '^@bymax-one/nest-realtime$': '<rootDir>/server/index.ts',
    '^@bymax-one/nest-realtime/internal$': '<rootDir>/internal/index.ts',
    '^@bymax-one/nest-realtime/shared$': '<rootDir>/shared/index.ts',
    '^@bymax-one/nest-realtime/react$': '<rootDir>/react/index.ts',
  },
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
  collectCoverage: false,
}

export default config
