import type { Config } from 'jest'

/**
 * End-to-end runner for the SSE/WebSocket suites under `test/e2e/`.
 *
 * `rootDir` is the repo root with a `testMatch` scoped to `test/e2e/` so the step
 * stays green before any e2e spec exists (the directory is created on demand).
 * The timeout is generous because SSE keepalive cycles can exceed 5s.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  // The Redis-dependent cross-instance suite is excluded from the per-PR run and
  // exercised by the scheduled workflow. Excluding it via config (not a CLI flag)
  // avoids a fragile override: pnpm forwards `--` to jest, which then treats the
  // flag as a positional path filter and silently matches no tests.
  testPathIgnorePatterns: ['/node_modules/', '/cross-instance/'],
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.e2e.json', isolatedModules: true },
    ],
  },
  testTimeout: 15_000,
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
}

export default config
