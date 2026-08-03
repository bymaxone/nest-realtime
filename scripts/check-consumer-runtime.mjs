#!/usr/bin/env node
/**
 * Consumer runtime gate (zero external dependencies).
 *
 * Every other gate reads the source or the type declarations. This one packs the
 * tarball, lays it out the way npm would, and boots NestJS against it — in ESM
 * and in CommonJS — because a defect in how the entry points are *bundled* is
 * invisible to all of them.
 *
 * What it proves: a consumer can register the WebSocket module from
 * `@bymax-one/nest-realtime/websocket` and then resolve services and injection
 * tokens imported from the package root. Entry points are separate bundles, so a
 * module reached from two of them by a relative path is copied into each, and a
 * copied class or `Symbol` is a different injection token — the container then
 * rejects every public token with `UnknownElementException` while the source
 * suite, the type tests and `attw` all stay green.
 *
 * Usage: `node scripts/check-consumer-runtime.mjs` (run after `pnpm build`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = '@bymax-one/nest-realtime'

// The consumer lives inside the repository so Node walks up to the repo's own
// `node_modules` for the peer dependencies. Nothing is installed and nothing is
// fetched; only the package under test comes from the tarball.
const consumerDir = join(rootDir, '.consumer-runtime-check')

/** Provider tokens every entry point exports, named as a consumer imports them. */
const EXPORTED_TOKENS = [
  'RealtimeService',
  'ConnectionRegistry',
  'REALTIME_OPTIONS_TOKEN',
  'REALTIME_INSTANCE_ID_TOKEN',
  'REALTIME_AUTHENTICATOR_TOKEN',
  'REALTIME_PUBSUB_TOKEN',
  'REALTIME_HOOKS_TOKEN',
  'REALTIME_OFFLINE_QUEUE_TOKEN',
  'REALTIME_PRESENCE_TOKEN',
  'REALTIME_TRANSPORT_TOKEN',
]

/** Values the package root must expose, whatever the resolution mode. */
const ROOT_EXPORTS = [
  ...EXPORTED_TOKENS,
  'BymaxRealtimeModule',
  'InMemoryPubSub',
  'RedisOfflineQueue',
  'RedisRealtimePubSub',
  'ROOM_PREFIXES',
  'RESERVED_EVENT_NAMES',
  'REALTIME_ERROR_CODES',
  'composeRoomId',
]

/** Values the WebSocket subpath must expose. */
const WEBSOCKET_EXPORTS = [
  'BymaxRealtimeWebSocketModule',
  'WebSocketTransport',
  'RealtimeGateway',
  'RealtimeIoAdapter',
  'CompositeTransport',
]

/**
 * The probe, identical in both formats. Only the four bindings it opens with
 * differ, which is the point: the same assertions have to hold under `import`
 * and under `require`, and only running both can show that they do.
 */
const probeBody = `
const failures = []
const check = (name, fn) => {
  try {
    const detail = fn()
    if (detail) failures.push(name + ' — ' + detail)
  } catch (error) {
    failures.push(name + ' — threw: ' + (error && error.message ? error.message : String(error)))
  }
}

const authenticator = { authenticate: async () => ({ authenticated: false }) }
const options = (transport) => ({ transport, authenticator })

const missing = (namespace, names) =>
  names.filter((name) => namespace[name] === undefined).join(', ')

check('root exports', () => {
  const absent = missing(root, ${JSON.stringify(ROOT_EXPORTS)})
  return absent && 'not exported: ' + absent
})

check('websocket exports', () => {
  const absent = missing(ws, ${JSON.stringify(WEBSOCKET_EXPORTS)})
  return absent && 'not exported: ' + absent
})

// The gate itself: a module registered from one entry point, every public token
// resolved through the object the *other* entry point exports. A second copy of
// the shared runtime fails here and nowhere else.
const resolveAll = async (label, dynamicModule) => {
  const app = await NestFactory.createApplicationContext(dynamicModule, { logger: false })
  try {
    const unresolved = []
    for (const name of ${JSON.stringify(EXPORTED_TOKENS)}) {
      try {
        app.get(root[name])
      } catch (error) {
        const kind = error && error.constructor ? error.constructor.name : 'Error'
        unresolved.push(name + ' (' + kind + ')')
      }
    }
    if (unresolved.length) return label + ': ' + unresolved.join(', ')
    const service = app.get(root.RealtimeService)
    if (!(service instanceof root.RealtimeService)) {
      return label + ': RealtimeService instance is not an instance of the exported class'
    }
    return ''
  } finally {
    await app.close()
  }
}

const main = async () => {
  const cases = [
    ['websocket via ./websocket', () => ws.BymaxRealtimeWebSocketModule.forRoot(options('websocket'))],
    ['both via ./websocket', () => ws.BymaxRealtimeWebSocketModule.forRoot(options('both'))],
    ['sse via root', () => root.BymaxRealtimeModule.forRoot(options('sse'))],
    [
      'websocket via ./websocket (async)',
      () =>
        ws.BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
          useFactory: () => options('websocket'),
        }),
    ],
  ]
  for (const [label, build] of cases) {
    let dynamicModule
    try {
      dynamicModule = build()
    } catch (error) {
      failures.push('compose ' + label + ' — threw: ' + error.message)
      continue
    }
    try {
      const detail = await resolveAll(label, dynamicModule)
      if (detail) failures.push('resolve ' + detail)
    } catch (error) {
      failures.push('bootstrap ' + label + ' — threw: ' + error.message)
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error('  ✗ ' + failure)
    process.exit(1)
  }
  console.log('  ✓ ' + FORMAT + ': ' + cases.length + ' registrations, ' +
    ${EXPORTED_TOKENS.length} + ' tokens each, resolved through the package root')
}

main().catch((error) => {
  console.error('  ✗ ' + FORMAT + ' probe crashed: ' + (error && error.stack ? error.stack : error))
  process.exit(1)
})
`

const esmProbe = `import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import * as root from '${packageName}'
import * as ws from '${packageName}/websocket'
const FORMAT = 'ESM'
${probeBody}`

const cjsProbe = `require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const root = require('${packageName}')
const ws = require('${packageName}/websocket')
const FORMAT = 'CJS'
${probeBody}`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
}

function cleanup() {
  rmSync(consumerDir, { recursive: true, force: true })
}

console.log('Consumer runtime gate')

if (!existsSync(join(rootDir, 'dist'))) {
  console.error('✗ dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

cleanup()
const packDir = mkdtempSync(join(tmpdir(), 'nest-realtime-pack-'))
let failed = false

try {
  // `--ignore-scripts` keeps `prepublishOnly` from rebuilding underneath the
  // artifact this gate is meant to inspect.
  // The tarball is located by reading the directory it was packed into, not by
  // parsing `npm pack`'s stdout. Inside a publish, npm writes notices around the
  // filename, so taking the last line yields a path with trailing text and `tar`
  // fails on a name that does not exist. The directory is freshly created and
  // holds exactly one archive.
  // `npm_config_dry_run` is cleared for the child: a `npm publish --dry-run`
  // pre-flight exports it, the nested pack inherits it, and a dry pack writes no
  // file — so the gate would report a missing tarball for a reason that has
  // nothing to do with the package. Cleared, the gate means the same thing in
  // every context it can be invoked from.
  const packEnv = { ...process.env }
  delete packEnv['npm_config_dry_run']
  run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], { env: packEnv })
  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== 1) {
    throw new Error(`expected one tarball in ${packDir}, found ${packed.length}`)
  }
  const tarball = join(packDir, packed[0])

  const packageDir = join(consumerDir, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'consumer-runtime-check', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  )
  writeFileSync(join(consumerDir, 'probe.mjs'), esmProbe)
  writeFileSync(join(consumerDir, 'probe.cjs'), cjsProbe)

  for (const probe of ['probe.mjs', 'probe.cjs']) {
    try {
      process.stdout.write(run('node', [probe], { cwd: consumerDir, stdio: 'pipe' }))
    } catch (error) {
      process.stdout.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      failed = true
    }
  }
} catch (error) {
  console.error(`✗ gate setup failed: ${error.message}`)
  if (error.stderr) process.stderr.write(error.stderr)
  failed = true
} finally {
  cleanup()
  rmSync(packDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\n✗ The published artifact does not work for a consumer.')
  process.exit(1)
}

console.log('✓ Entry points share one runtime in ESM and CommonJS.')
