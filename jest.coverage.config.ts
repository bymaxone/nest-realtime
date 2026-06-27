import type { Config } from 'jest'

/**
 * Coverage gate — the Bymax library standard: 100% line/branch/function/statement
 * coverage on every implemented file. Type-only files (interfaces, `*.type.ts`)
 * and barrels are excluded because they carry no executable logic.
 *
 * Kept self-contained (no cross-config import) so the TypeScript config loads
 * under the package's native ESM resolution.
 *
 * Both `src/` (library) and `test/fixtures` + `test/integration` (fixture specs and
 * integration specs) are included so fixture and integration suites run alongside
 * unit tests with the same configuration.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/test/fixtures/**/*.spec.ts',
    '<rootDir>/test/integration/**/*.spec.ts',
  ],
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
  maxWorkers: '50%',
  passWithNoTests: true,
  clearMocks: true,
  restoreMocks: true,
  collectCoverage: true,
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/server/**/*.ts',
    'src/shared/**/*.ts',
    'src/react/**/*.ts',
    '!**/index.ts',
    '!**/*.spec.ts',
    '!**/interfaces/**',
    '!**/*.interface.ts',
    '!**/*.type.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
}

export default config
