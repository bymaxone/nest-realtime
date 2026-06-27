import type { Config } from 'jest'

/**
 * Jest configuration used by the Stryker mutation runner. Coverage collection is
 * disabled — Stryker performs its own per-test coverage analysis. Kept
 * self-contained so the TypeScript config loads under native ESM resolution.
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
  collectCoverage: false,
}

export default config
