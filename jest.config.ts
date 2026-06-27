import type { Config } from 'jest'

/**
 * Fast development test runner.
 *
 * Transforms TypeScript through ts-jest (CommonJS output) so NestJS decorator
 * metadata is emitted for dependency injection. `reflect-metadata` is loaded
 * before each suite. Worker pool is capped for memory safety when many
 * long-lived realtime primitives are exercised in parallel.
 */
const config: Config = {
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.jest.json', isolatedModules: true },
    ],
  },
  moduleNameMapper: {
    '^@bymax-one/nest-realtime$': '<rootDir>/server/index.ts',
    '^@bymax-one/nest-realtime/shared$': '<rootDir>/shared/index.ts',
    '^@bymax-one/nest-realtime/react$': '<rootDir>/react/index.ts',
  },
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
}

export default config
