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
 * Usage: `node scripts/check-consumer-runtime.mjs` (run after `pnpm build`) packs the repository
 * itself. With `PACKAGE_TARBALL` set to the path of a tarball, it boots that file instead and packs
 * nothing, so a release can run this gate on the exact file it publishes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumerTypeFailures } from './consumer-types-rows.mjs'

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

/** Values the observability subpath must expose. */
const OBSERVABILITY_EXPORTS = ['RealtimeMetrics', 'RealtimePubSubHealthIndicator']

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

check('observability exports', () => {
  const absent = missing(obs, ${JSON.stringify(OBSERVABILITY_EXPORTS)})
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

// The optional entry must resolve what it injects from the one shared runtime: registered as plain providers
// of a host module it boots, publishes its five collectors and reports its indicator up. A second copy of the
// shared runtime makes the boot fail with an unresolved dependency, as it does for the tokens above.
const observabilityBoots = async () => {
  class Host {}
  Module({
    imports: [root.BymaxRealtimeModule.forRoot(options('sse'))],
    providers: [obs.RealtimeMetrics, obs.RealtimePubSubHealthIndicator],
  })(Host)
  const app = await NestFactory.createApplicationContext(Host, { logger: false })
  try {
    const registry = new prom.Registry()
    app.get(obs.RealtimeMetrics).registerMetrics(registry)
    const names = (await registry.getMetricsAsJSON()).map((metric) => metric.name)
    if (names.length !== 5) return 'expected five collectors, found ' + names.length
    const health = await app.get(obs.RealtimePubSubHealthIndicator).check()
    return health.status === 'up' ? '' : 'the indicator reported ' + health.status + ' on a healthy bus'
  } finally {
    await app.close()
  }
}

// The packed artifact must install the Redis adapter in both module formats. The assertion reads
// the adapter the Socket.IO server ends up with: the in-memory default is a working server too.
const redisAdapterRegisters = async () => {
  const Mock = IORedisMock.default ?? IORedisMock
  const pubClient = new Mock()
  const app = await NestFactory.create(
    ws.BymaxRealtimeWebSocketModule.forRoot({
      transport: 'websocket',
      authenticator,
      websocket: { redisAdapter: { pubClient } },
    }),
    { logger: false },
  )
  let server
  try {
    server = new ws.RealtimeIoAdapter(app).createIOServer(0)
    const name = server.of('/').adapter.constructor.name
    return name === 'Adapter' ? 'redis adapter not installed: the server kept the in-memory adapter' : ''
  } finally {
    server?.close()
    pubClient.disconnect()
    await app.close()
  }
}

// The transports take the instance's admission as an optional dependency, so a second copy of it
// would not fail to boot: the cap would silently not apply. This is the check that sees that.
const connectionCapApplies = async () => {
  const app = await NestFactory.createApplicationContext(
    ws.BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator, maxConnections: 1 }),
    { logger: false },
  )
  try {
    const transport = app.get(ws.WebSocketTransport)
    transport.admit()
    try {
      transport.admit()
    } catch (error) {
      return error && error.limit === 1 ? '' : 'refused with something other than the limit: ' + error
    }
    return 'a second connection was admitted with maxConnections 1: the cap does not apply'
  } finally {
    await app.close()
  }
}

const main = async () => {
  try {
    const detail = await redisAdapterRegisters()
    if (detail) failures.push('redisAdapter — ' + detail)
  } catch (error) {
    failures.push('redisAdapter — threw: ' + error.message)
  }
  try {
    const detail = await connectionCapApplies()
    if (detail) failures.push('maxConnections — ' + detail)
  } catch (error) {
    failures.push('maxConnections — threw: ' + error.message)
  }
  try {
    const detail = await observabilityBoots()
    if (detail) failures.push('observability — ' + detail)
  } catch (error) {
    failures.push('observability — threw: ' + error.message)
  }
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
  console.log('  ✓ ' + FORMAT + ': Redis adapter registers, the connection cap applies, ' + cases.length + ' registrations, ' +
    ${EXPORTED_TOKENS.length} + ' tokens each, resolved through the package root')
}

main().catch((error) => {
  console.error('  ✗ ' + FORMAT + ' probe crashed: ' + (error && error.stack ? error.stack : error))
  process.exit(1)
})
`

const esmProbe = `import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import * as prom from 'prom-client'
import * as root from '${packageName}'
import * as ws from '${packageName}/websocket'
import * as obs from '${packageName}/observability'
import IORedisMock from 'ioredis-mock'
const FORMAT = 'ESM'
${probeBody}`

const cjsProbe = `require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { Module } = require('@nestjs/common')
const prom = require('prom-client')
const root = require('${packageName}')
const ws = require('${packageName}/websocket')
const obs = require('${packageName}/observability')
const IORedisMock = require('ioredis-mock')
const FORMAT = 'CJS'
${probeBody}`

/**
 * The rejection probe, identical in both formats. A `tenantResolver` that returns a rejecting promise must not
 * leave an unhandled rejection in the consumer's process, whatever kind of promise it is. It runs as its own
 * process against the packed artifact because a test runner installs handlers of its own that can hide the
 * very event this probe is looking for.
 */
const rejectionProbeBody = `
const unhandled = []
process.on('unhandledRejection', (reason) => unhandled.push(String(reason && reason.message ? reason.message : reason)))

class OverridesCatch extends Promise {
  catch() {
    throw new Error('own catch')
  }
}
const withOwnThen = Promise.reject(new Error('own then'))
Object.defineProperty(withOwnThen, 'then', {
  value: () => {
    throw new Error('own then called')
  },
})
const kinds = {
  'a native promise': () => Promise.reject(new Error('native')),
  'a promise from another realm': () => vm.runInNewContext("Promise.reject(new Error('cross-realm'))"),
  'a subclass that overrides catch': () => OverridesCatch.reject(new Error('subclass')),
  'a promise with a then of its own': () => withOwnThen,
  'a proxy over a promise with bound methods': () =>
    new Proxy(Promise.reject(new Error('proxied')), {
      get: (target, key) => {
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
}

for (const [name, build] of Object.entries(kinds)) {
  try {
    resolveAuthTenant({ tenantResolver: build }, { userId: 'u1' })
  } catch (error) {
    console.error('  ✗ ' + FORMAT + ': ' + name + ' made resolveAuthTenant throw: ' + error.message)
    process.exit(1)
  }
}

setTimeout(() => {
  if (unhandled.length > 0) {
    console.error('  ✗ ' + FORMAT + ': an unhandled rejection reached the process: ' + unhandled.join(', '))
    process.exit(1)
  }
  console.log('  ✓ ' + FORMAT + ': a rejecting promise from a tenantResolver leaves no unhandled rejection, ' + Object.keys(kinds).length + ' kinds')
}, 50)
`

/**
 * The single-engine probe, identical in both formats. With `websocket.namespace` set and a gateway of the application's own
 * that declares a namespace, every upgrade must reach one engine: a second one on the HTTP server makes the second
 * `handleUpgrade` throw and ends the process. The probe is the process, so a death is a failed gate, and it makes fifty
 * upgrades with a raw socket, which needs no client library, to see that none of them ends it.
 */
const singleEngineProbeBody = `
;(async () => {
const fail = (message) => {
  console.error('  ✗ ' + FORMAT + ': ' + message)
  process.exit(1)
}
process.on('uncaughtException', (error) => fail('an upgrade ended the process: ' + String(error.message).slice(0, 80)))
const { Module } = common
const upgrade = (port, path) =>
  new Promise((done) => {
    const socket = net.connect(port, '127.0.0.1')
    let answer = ''
    socket.on('data', (chunk) => {
      answer += chunk.toString('latin1')
      socket.destroy()
    })
    socket.on('close', () => done(answer.split('\\r\\n')[0] || 'closed'))
    socket.on('error', () => done('error'))
    socket.write('GET ' + path + ' HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n')
    setTimeout(() => socket.destroy(), 1000)
  })
for (const hostNamespace of ['y', 'rt']) {
  class Host {
    handleConnection() {}
  }
  websockets.WebSocketGateway({ namespace: hostNamespace })(Host)
  class Library {}
  Module({
    imports: [
      ws.BymaxRealtimeWebSocketModule.forRoot({
        transport: 'websocket',
        authenticator: { authenticate: async () => null },
        websocket: { namespace: '/rt' },
      }),
    ],
    providers: [Host],
  })(Library)
  const app = await NestFactory.create(Library, { logger: false })
  app.useWebSocketAdapter(new ws.RealtimeIoAdapter(app))
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer()
  const label = 'a gateway of the namespace /' + hostNamespace
  if (server.listenerCount('upgrade') !== 1) fail(label + ' left ' + server.listenerCount('upgrade') + ' upgrade listeners, not 1')
  const port = server.address().port
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = await upgrade(port, '/socket.io/?EIO=4&transport=websocket')
    if (!status.includes('101')) fail(label + ': upgrade ' + attempt + ' answered ' + status)
  }
  await app.close()
}
console.log('  ✓ ' + FORMAT + ': 50 upgrades with websocket.namespace and a gateway of another namespace, or of the same one, leave one engine and a live process')
})()
`

/**
 * The pre-load probe, identical in both formats. `vm` reads its options with inheritance, so a wrong-typed value planted
 * under one of their names makes it throw, with the planted value in the message. The library builds a realm with `vm`
 * when the WebSocket entry loads: the import must not throw, and the server must refuse to run with the count-only error
 * and none of what was planted in it. The peers load first, as they do in a consumer that plants after its framework and
 * before the library. It runs as its own process because the planted key would break the rest of the probes.
 */
const preloadProbeBody = `
;(async () => {
const SECRET = 'SECRET-planted-value'
const fail = (message) => {
  console.error('  ✗ ' + FORMAT + ': ' + message)
  process.exit(1)
}
Object.prototype.microtaskMode = SECRET
let ws
try {
  ws = await loadWebSocketEntry()
} catch (error) {
  fail('the import threw with a key planted under a vm option: ' + error.code + ' ' + String(error.message).slice(0, 80))
}
const refusal = () => {
  try {
    new ws.RealtimeIoAdapter({ get: () => ({}) }).createIOServer(0, {})
  } catch (error) {
    return error
  }
  return undefined
}
for (const phase of ['while the key is planted', 'after it is removed']) {
  const error = refusal()
  if (error === undefined) fail('the server was created ' + phase)
  if (error.code !== 'REALTIME_TRANSPORT_UNAVAILABLE') fail('the refusal ' + phase + ' had the code ' + error.code)
  if (!/\\b1 change\\b/.test(error.message)) fail('the refusal ' + phase + ' did not count one change: ' + error.message)
  if (error.message.includes(SECRET)) fail('the refusal ' + phase + ' holds the planted value')
  delete Object.prototype.microtaskMode
}
console.log('  ✓ ' + FORMAT + ': a key planted under a vm option before the library loads is refused with a count and nothing of it')
})().catch((error) => {
  console.error('  ✗ ' + FORMAT + ' preload probe crashed: ' + (error && error.stack ? error.stack : error))
  process.exit(1)
})
`

const esmPreloadProbe = `import 'reflect-metadata'
import '@nestjs/common'
import '@nestjs/core'
import '@nestjs/websockets'
import '@nestjs/platform-socket.io'
import 'socket.io'
const FORMAT = 'ESM'
const loadWebSocketEntry = () => import('${packageName}/websocket')
${preloadProbeBody}`

const cjsPreloadProbe = `require('reflect-metadata')
require('@nestjs/common')
require('@nestjs/core')
require('@nestjs/websockets')
require('@nestjs/platform-socket.io')
require('socket.io')
const FORMAT = 'CJS'
const loadWebSocketEntry = async () => require('${packageName}/websocket')
${preloadProbeBody}`

const esmSingleEngineProbe = `import 'reflect-metadata'
import net from 'node:net'
import * as common from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import * as websockets from '@nestjs/websockets'
import '@nestjs/platform-socket.io'
import 'socket.io'
import * as ws from '${packageName}/websocket'
const FORMAT = 'ESM'
${singleEngineProbeBody}`

const cjsSingleEngineProbe = `require('reflect-metadata')
const net = require('node:net')
const common = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const websockets = require('@nestjs/websockets')
require('@nestjs/platform-socket.io')
require('socket.io')
const ws = require('${packageName}/websocket')
const FORMAT = 'CJS'
${singleEngineProbeBody}`

const esmRejectionProbe = `import vm from 'node:vm'
import { resolveAuthTenant } from '${packageName}/internal'
const FORMAT = 'ESM'
${rejectionProbeBody}`

const cjsRejectionProbe = `const vm = require('node:vm')
const { resolveAuthTenant } = require('${packageName}/internal')
const FORMAT = 'CJS'
${rejectionProbeBody}`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
}

/**
 * Packs this repository into `packDir` and returns the tarball's path.
 *
 * `--ignore-scripts` keeps `prepublishOnly` from rebuilding underneath the artifact this gate is
 * meant to inspect. The tarball is located by reading the directory it was packed into, not by
 * parsing `npm pack`'s stdout: inside a publish, npm writes notices around the filename, so taking
 * the last line yields a path with trailing text and `tar` fails on a name that does not exist. The
 * directory is freshly created and holds exactly one archive. `npm_config_dry_run` is cleared for
 * the child: a `npm publish --dry-run` pre-flight exports it, the nested pack inherits it, and a dry
 * pack writes no file, so the gate would report a missing tarball for a reason that has nothing to
 * do with the package. Cleared, the gate means the same thing in every context it can be invoked
 * from. `cwd: rootDir`: the package to pack is this repository's, whatever directory the script was
 * invoked from; without it the gate would inspect whichever package npm resolved from the caller's
 * cwd.
 */
function packRepository() {
  const packEnv = { ...process.env }
  delete packEnv['npm_config_dry_run']
  run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], {
    cwd: rootDir,
    env: packEnv,
  })
  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== 1) {
    throw new Error(`expected one tarball in ${packDir}, found ${packed.length}`)
  }
  return join(packDir, packed[0])
}

function cleanup() {
  rmSync(consumerDir, { recursive: true, force: true })
}

console.log('Consumer runtime gate')

// A tarball the caller supplies is the artifact under test; without one this gate packs the repository.
// An empty variable is no tarball: `resolve('')` is the current directory, which `tar` cannot open.
const suppliedTarball = process.env['PACKAGE_TARBALL'] || undefined

if (suppliedTarball === undefined && !existsSync(join(rootDir, 'dist'))) {
  console.error('✗ dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

cleanup()
const packDir = mkdtempSync(join(tmpdir(), 'nest-realtime-pack-'))
let failed = false

try {
  const tarball = suppliedTarball === undefined ? packRepository() : resolve(suppliedTarball)
  if (!existsSync(tarball)) throw new Error(`the tarball ${tarball} does not exist`)

  const packageDir = join(consumerDir, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'consumer-runtime-check', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  )
  writeFileSync(join(consumerDir, 'probe.mjs'), esmProbe)
  writeFileSync(join(consumerDir, 'probe.cjs'), cjsProbe)
  writeFileSync(join(consumerDir, 'preload.mjs'), esmPreloadProbe)
  writeFileSync(join(consumerDir, 'preload.cjs'), cjsPreloadProbe)
  writeFileSync(join(consumerDir, 'rejections.mjs'), esmRejectionProbe)
  writeFileSync(join(consumerDir, 'rejections.cjs'), cjsRejectionProbe)
  writeFileSync(join(consumerDir, 'engine.mjs'), esmSingleEngineProbe)
  writeFileSync(join(consumerDir, 'engine.cjs'), cjsSingleEngineProbe)

  // A consumer's bundler picks the package's `import` build by the consumer's import syntax, whatever
  // format it emits. The same probe, bundled to CommonJS with esbuild (the engine of this repo's own
  // build tool, resolved from it so nothing new is installed), must load and register the adapter.
  const requireFromHere = createRequire(import.meta.url)
  const esbuildPath = requireFromHere.resolve('esbuild', {
    paths: [dirname(requireFromHere.resolve('tsup/package.json'))],
  })
  writeFileSync(
    join(consumerDir, 'probe-rebundle.mjs'),
    esmProbe.replace("const FORMAT = 'ESM'", "const FORMAT = 'ESM re-bundled to CommonJS'"),
  )
  await requireFromHere(esbuildPath).build({
    absWorkingDir: consumerDir,
    entryPoints: ['probe-rebundle.mjs'],
    outfile: 'probe-rebundled.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [
      '@nestjs/*',
      'reflect-metadata',
      'rxjs',
      'socket.io',
      '@socket.io/redis-adapter',
      'ioredis',
      'ioredis-mock',
    ],
    // Inside this repository esbuild would resolve the package name to the repository itself;
    // every entry point is pinned to the extracted tarball so the bundle holds one copy of it.
    alias: {
      [packageName]: join(packageDir, 'dist/server/index.mjs'),
      [`${packageName}/websocket`]: join(packageDir, 'dist/websocket/index.mjs'),
      [`${packageName}/observability`]: join(packageDir, 'dist/observability/index.mjs'),
      [`${packageName}/internal`]: join(packageDir, 'dist/internal/index.mjs'),
      [`${packageName}/shared`]: join(packageDir, 'dist/shared/index.mjs'),
    },
    logLevel: 'silent',
  })

  for (const probe of [
    'probe.mjs',
    'probe.cjs',
    'probe-rebundled.cjs',
    'preload.mjs',
    'preload.cjs',
    'rejections.mjs',
    'rejections.cjs',
    'engine.mjs',
    'engine.cjs',
  ]) {
    try {
      process.stdout.write(run('node', [probe], { cwd: consumerDir, stdio: 'pipe' }))
    } catch (error) {
      process.stdout.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      failed = true
    }
  }
  for (const failure of consumerTypeFailures({
    rootDir,
    tarball,
    packageName,
    workDir: consumerDir,
  })) {
    console.error(`✗ ${failure}`)
    failed = true
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
