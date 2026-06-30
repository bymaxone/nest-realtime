import type { Config } from 'jest'

/**
 * Fast development test runner.
 *
 * Two Jest projects share the root runner:
 *   - `server` — NestJS + shared code; runs under `node` with `reflect-metadata`.
 *   - `react`  — React 19 hooks + provider; runs under `jsdom` with the
 *                EventSource/socket.io-client mocks wired up via setupFilesAfterEnv.
 *
 * Worker pool is capped at 50% for memory safety when many long-lived realtime
 * primitives run concurrently under test.
 */
const config: Config = {
  rootDir: '.',
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
  projects: [
    {
      displayName: 'server',
      testMatch: [
        '<rootDir>/src/server/**/*.spec.ts',
        '<rootDir>/src/shared/**/*.spec.ts',
        '<rootDir>/test/fixtures/**/*.spec.ts',
        '<rootDir>/test/integration/**/*.spec.ts',
      ],
      testEnvironment: 'node',
      moduleFileExtensions: ['ts', 'js', 'json'],
      setupFiles: ['reflect-metadata'],
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          { tsconfig: '<rootDir>/tsconfig.jest.json', isolatedModules: true },
        ],
      },
      moduleNameMapper: {
        '^@bymax-one/nest-realtime$': '<rootDir>/src/server/index.ts',
        '^@bymax-one/nest-realtime/shared$': '<rootDir>/src/shared/index.ts',
        '^@bymax-one/nest-realtime/react$': '<rootDir>/src/react/index.ts',
      },
    },
    {
      displayName: 'react',
      testMatch: [
        '<rootDir>/src/react/**/*.spec.tsx',
        '<rootDir>/src/react/**/*.spec.ts',
      ],
      testEnvironment: 'jsdom',
      moduleFileExtensions: ['tsx', 'ts', 'js', 'json'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/react-setup.ts'],
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          { tsconfig: '<rootDir>/tsconfig.jest.json', isolatedModules: true },
        ],
      },
      moduleNameMapper: {
        '^@bymax-one/nest-realtime$': '<rootDir>/src/server/index.ts',
        '^@bymax-one/nest-realtime/shared$': '<rootDir>/src/shared/index.ts',
        '^@bymax-one/nest-realtime/react$': '<rootDir>/src/react/index.ts',
      },
    },
  ],
}

export default config
