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
