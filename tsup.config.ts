import { defineConfig } from 'tsup'

/**
 * Bundle externals shared by the server and React entries.
 *
 * `socket.io-client` is listed here deliberately: it must stay external AND must
 * never appear in the static bundle of `dist/react/index.mjs`. The React subpath
 * loads it through a dynamic `import()` only, keeping the SSE-only consumer bundle
 * minimal (see `scripts/check-size.mjs`).
 */
const externalAll = [
  /^@nestjs\//,
  'reflect-metadata',
  'rxjs',
  'socket.io',
  '@socket.io/redis-adapter',
  'ioredis',
  'react',
  'react-dom',
  'socket.io-client',
]

export default defineConfig([
  // Server entry (main) — NestJS module + transports.
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: externalAll,
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
  // Shared entry — zero-dependency types + constants (no NestJS externals).
  {
    entry: { 'shared/index': 'src/shared/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
  // React entry — browser hooks/provider; SSE-only base bundle.
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: externalAll,
    target: 'es2022',
    platform: 'neutral',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
])
