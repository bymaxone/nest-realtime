import type { Config } from 'jest'

/**
 * Coverage gate — the Bymax library standard: 100% line/branch/function/statement
 * coverage on every implemented file. Type-only files (interfaces, `*.type.ts`)
 * and barrels are excluded because they carry no executable logic.
 *
 * Kept self-contained (no cross-config import) so the TypeScript config loads
 * under the package's native ESM resolution.
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
  collectCoverage: true,
  collectCoverageFrom: [
    'server/**/*.ts',
    'shared/**/*.ts',
    'react/**/*.ts',
    '!**/index.ts',
    '!**/*.spec.ts',
    '!**/interfaces/**',
    '!**/*.interface.ts',
    '!**/*.type.ts',
  ],
  coverageDirectory: '<rootDir>/../coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
}

export default config
