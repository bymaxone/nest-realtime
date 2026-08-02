import { defineConfig } from 'tsup'

/**
 * Bundle externals shared by the server and React entries.
 *
 * The package's own subpaths lead the list. Entry points are separate bundles,
 * so a module two of them reach by a relative path is copied into each, and a
 * copied class or `Symbol` is a different injection token — registering a module
 * from one entry and injecting its services from another then fails with
 * `UnknownElementException`. Keeping the specifier external makes the shared
 * runtime a single bundle both entries import, in CommonJS as well as ESM, which
 * code splitting could not do since esbuild splits ESM only.
 *
 * `socket.io-client` is listed here deliberately: it must stay external AND must
 * never appear in the static bundle of `dist/react/index.mjs`. The React subpath
 * loads it through a dynamic `import()` only, keeping the SSE-only consumer bundle
 * minimal (see `scripts/check-size.mjs`).
 */
const externalAll = [
  /^@bymax-one\/nest-realtime\//,
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
  // Shared runtime — the single bundle the server and WebSocket entries import
  // by package specifier, so their common services keep one identity. Not
  // public API; present in `exports` only because it must resolve at runtime.
  {
    entry: { 'internal/index': 'src/internal/index.ts' },
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
  // Server entry (main) — the SSE module, re-exported from the shared runtime.
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
  // WebSocket entry — the Socket.IO stack, kept out of the server entry so an
  // SSE application never loads `@nestjs/websockets` or `socket.io`. Everything
  // it shares with the root comes from the internal entry, never a relative path.
  {
    entry: { 'websocket/index': 'src/websocket/index.ts' },
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
