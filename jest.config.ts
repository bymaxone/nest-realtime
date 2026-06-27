import type { Config } from 'jest'

/**
 * Fast development test runner.
 *
 * Transforms TypeScript through ts-jest (CommonJS output) so NestJS decorators
 * evaluate. Dependency injection uses explicit `@Inject(token)` everywhere, so
 * `emitDecoratorMetadata` is intentionally off in `tsconfig.jest.json` — leaving it
 * on would add unreachable `design:paramtypes` branches that make 100% branch
 * coverage impossible. `reflect-metadata` is loaded before each suite. Worker pool
 * is capped for memory safety when many long-lived realtime primitives run.
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
}

export default config
