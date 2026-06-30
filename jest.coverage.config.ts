import type { Config } from 'jest'

/**
 * Coverage gate — the Bymax library standard: 100% line/branch/function/statement
 * coverage on every implemented file. Type-only files (interfaces, `*.type.ts`)
 * and barrels are excluded because they carry no executable logic.
 *
 * Two Jest projects share the coverage run:
 *   - `server` — NestJS + shared code; node environment.
 *   - `react`  — React 19 hooks + provider; jsdom environment.
 */
const config: Config = {
  rootDir: '.',
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
    'src/react/**/*.tsx',
    '!**/index.ts',
    '!**/index.tsx',
    '!**/*.spec.ts',
    '!**/*.spec.tsx',
    '!**/interfaces/**',
    '!**/*.interface.ts',
    '!**/*.type.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
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
