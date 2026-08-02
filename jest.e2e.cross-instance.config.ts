import type { Config } from 'jest'

/**
 * Runner for the Redis-dependent cross-instance suite, which the per-PR e2e
 * config deliberately excludes.
 *
 * It exists as its own config rather than as a CLI override on the other one for
 * the reason that config already documents: pnpm forwards `--` to jest, which
 * treats the flag as a positional path filter, and a filter cannot re-include a
 * path that `testPathIgnorePatterns` has excluded. The scheduled workflow did
 * exactly that and reported success while running no tests at all.
 *
 * `passWithNoTests` is false here on purpose. This runner exists to execute one
 * specific suite, so finding nothing means the wiring broke — the failure mode
 * this file was written to end — and it must fail rather than exit 0.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/e2e/cross-instance/**/*.e2e-spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.e2e.json', isolatedModules: true }],
  },
  testTimeout: 60_000,
  maxWorkers: '50%',
  passWithNoTests: false,
  clearMocks: true,
  restoreMocks: true,
}

export default config
