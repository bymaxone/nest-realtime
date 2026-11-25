#!/usr/bin/env node
/**
 * Bundle-size gate (zero external dependencies).
 *
 * Validates the brotli-compressed size of each subpath bundle against its budget
 * and fails the build when a budget is exceeded. Budgets are BROTLI bytes (never
 * gzip): the brotli ratio is what CDNs serve, so it is the honest wire cost.
 *
 * It also enforces a structural invariant for the React subpath: `socket.io-client`
 * must NEVER appear statically in `dist/react/index.mjs`. The browser bundle is the
 * SSE-only base; `socket.io-client` is loaded through a dynamic `import()` only, so
 * an SSE-only consumer never pays for it.
 *
 * Usage: `node scripts/check-size.mjs` (run after `pnpm build`).
 */
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// Budgets are at or above the measured brotli sizes of the bundles as they ship, comments stripped
// by `scripts/strip-bundle-comments.mjs` (run by `pnpm build`). The margin differs per bundle and can
// be none, so a change that grows a bundle raises its budget in the same change, with its own
// measurement and reason. Each line is the measured size, then the budget:
//   server       247 B →    265 B (a re-export facade over the shared runtime)
//   internal  26,752 B → 26,782 B (the bulk of an SSE install: the route guard that authenticates
//     before the SSE response is committed, the handling that keeps an error's message out of the
//     stream, the peer address and the client address validated against the trusted-proxy chain,
//     the revocation that rejects when it cannot reach its connection, the report of a delivery
//     path that failed without failing its call, the Redis subscriber's lifecycle state, and the
//     bound on what a client may leave unread: the byte and event accounting, the exact size of
//     the frame Nest writes, the bounded authentication gate, the stall check and the close with its logged reason, and the
//     hook runner that keeps a consumer's failing lifecycle hook from reaching a connection, and
//     the bounded re-authentication cycle: the call timeout, the concurrency cap, the per-connection
//     guard and the boot validation of its options, and the instance-wide connection bound: the
//     admission service with its rate-limited log line, the place held for a handshake until it is
//     registered or its response closes, the 503 that refuses one past `maxConnections`, and the
//     rejection of a call that found no path, which is a 503 exception, and the last event id of a
//     reconnect: one resolver for the header and the query parameter, bounded in length, and the
//     read of an offline queue that wraps what a store returns before it counts the call, and the
//     short disconnect timeout of the subscriber, so that retiring one that has ended or is waiting
//     to reconnect does not wait out ioredis's 2,000 ms default, and the bounded close: a QUIT waited
//     for up to two seconds, then the connection disconnected, shared by the subscriber's retire and
//     by the Socket.IO adapter's close, and the one windowed report that the three rate-limited log
//     lines share: the helper is a closure, which measures 17,854 B; the same helper as a class
//     measures 17,892 B, so the closure is the shape that stays, and the bound on a publish to a
//     Redis that has stopped answering: the timer, its rejection and its cleanup, 52 B, and the
//     subscriber's reports of what it cannot act on: the shape check on a payload and the one
//     windowed line that counts the unknown ops and the failed handlings by class, 127 B, and the
//     non-enumerable `message` and `cause` of the 503 error, which keeps a driver's text out of what
//     a stringified instance carries, 33 B, and the
//     choice of what a failing `onConnect` does to its connection: the check of the option and the
//     SSE stream's close, 76 B, and the
//     one reserved-room rule that admission and `joinRoom` and `leaveRoom` share, 87 B, and the
//     shape check that refuses a room name that is not a non-empty string before any room API sees
//     it, called by the service and by the SSE transport, with the reserved-prefix refusal of the
//     SSE transport and the two checks exported to the other entries, 97 B, and the
//     helpers of `composeForRootAsync`, which stay within the 50-line function limit, 66 B, and the
//     start-up refusal of a value that is not a safe integer for the bound options, with a ceiling
//     for each and the message that names it, 77 B, and the removal of the keys that hold nothing
//     before the defaults merge and the type-only wording of every option refusal, with the key tables that read a group's known keys, 436 B, and the construction-time check of
//     `RedisOfflineQueue`'s two options, with its error, 117 B, and the start-up check of the shape of the
//     option groups and of the pluggable pieces, 448 B, and the refusal of an options argument, of a registration endpoint and of one with whitespace in it, of a built-in object where a group is expected, and of a queue built without its options or its client, 188 B, and the one test that counts the factory patterns and chooses the provider, so that a pattern set to `null` is read as unset, 42 B, and the read of the CORS block by the names of `CorsConfig` with the frozen copy of `roles` refused when its read throws, and the absorbed rejection of an async resolver, 173 B, with the CORS block read whenever it is an object rather than when it reports a plain type, 1 B, and the bound on the roles copy with its guard, and the absorption of a promise by the intrinsic then, 110 B, measured on 2026-11-21)
//     and, 991 B more than the figure above, the table of the built-ins and the symbol-keyed methods and flags of a regular expression the option, validation and admission code call, recorded when the library loads, with the count and the refusal that read it, measured on 2026-11-22)
//     and the wait under a deadline that the handshake gate, the re-authentication revalidate, the offline-queue replay, the Redis subscribe race and publish, and the SSE registration share, which uses no `Promise` static and no `then` and answers in a box with no prototype, and the check of the baseline and of the prototype chain of what each decision path returns, so that no object or array is handed over before the built-ins and the root prototypes are known to be intact; the figure on the first line is the measure of the whole bundle on 2026-11-24)
//     and, 104 B more than the figure above (of the websocket bundle, 29 B), measured on 2026-11-24, the pin that gives the promise each public method of the service hands back, and each caller's own await of a method that decides something, its own `constructor`, and the species getter of `Promise` in the table of built-ins,
//   websocket  8,486 B →  8,537 B (measured 8,463 B → 8,537 B, 74 B, of which 51 B is the budget over the old ratchet: the table that maps a namespace the adapter returned back to its root server, so that a gateway of another namespace joins the one server and no second engine is created on the HTTP server, measured on 2026-11-25)
//   websocket  8,456 B →  8,486 B (the Socket.IO stack alone: the start-up message that names the
//     fix when `RealtimeIoAdapter` is not installed, the boot error that names the cause when the
//     Redis adapter cannot be installed, the revocation that rejects when the server is not
//     attached or its fan-out throws, the one-time warning for an emit made before the server
//     is attached, the refusal of a handshake that arrives once shutdown has begun, the place held
//     for a handshake until its socket is registered or its engine connection closes, and the
//     transport code that marks a refusal the client can retry, the close of the subscriber
//     connection the Redis adapter opens, in `dispose` once every server has closed and on one
//     bound for all of them, and the guard on the commands that adapter never awaits, which keeps
//     their rejection from ending the process and warns once per connection, by class only, and the
//     refusal of a connection whose `onConnect` failed under `onConnectFailure: 'close'`, 31 B, and the room-name checks of the transport and of
//     the composite, which refuse what is not a non-empty string and what starts with a reserved
//     prefix, 49 B, and the helpers of `registerSocket`, which stay within the 50-line function
//     limit, 31 B, and the counting of the refusals, the revocations, the evictions and the deliveries in the tally the
//     observability entry reads, then the seam that wraps a handshake and a re-authentication cycle in a span when the optional API is installed, then the object form of every warn and error line with its stable code; on the shared runtime they cost 451 B, 519 B and 455 B, 4 B more for the rest, and 97 B for the host error written under `err`, the `error` refusal reason, and the guards for a proxy whose reads throw and for a provider with no factory, and 323 B for the refusal of an object whose read throws, wherever the host hands one over, of an `extraProviders` that is not an array of providers, and of the unavailable errors that carry no cause text in their message, and 36 B for the entries of `extraProviders` read under the guard, the reserved `service` and `version` log names and the refusal wording of a value whose type cannot be read, and 42 B for the record of an authentication result that the library keeps, built by name before the resolver, which is given the result itself, and 244 B for the keys of a `forRootAsync` registration read once under the guard, for the error an unreadable object's type tag raised kept as the cause, and for the answer of a synchronous factory read once and boxed, and 34 B for the tenant of an authentication result read once, with a resolver given its copy, and for the keys a logger reads as its own kept out of a log line, and 64 B for the guarded read of what a factory returns, so that a proxy that throws on `then` or was revoked is refused with the typed error and a log field cannot replace the event of its line (the message of the Redis adapter failure holds no cause text, and the websocket bundle measures 6,094 B), and on the WebSocket bundle 137 B, 134 B and 127 B, and 63 B for the error that closes a connection whose `onConnect` failed, measured on 2026-11-17)
//     and, 414 B in all, the refusal of a server run while `Object.prototype` holds a key outside the standard names or a standard name that was changed or was not the built-in of a clean realm at load, in boot, per request and per packet, with the own keys of the decoder subclass, measured on 2026-11-22)
//     and, 188 B more than the figure above, the clean-realm functions the guard's helpers call (the unshift that puts the request guard first, the keys and the definition of an own key, the check that it ended up first and the refusal of a server where it did not), the body of the 500 written as text, and the construction of that realm inside a try, measured on 2026-11-22)
//     and, 200 B more than the figure above, the count of the replaced built-ins and of the symbol keys in the guard and the check before each join of a room and each send, measured on 2026-11-22)
//   observability  1,092 B → 1,122 B (the metrics contributor and the pub/sub health indicator: five collectors read from the tally and the registry, the
//     entry nobody installs unless they publish metrics, so it carries no weight for anyone else)
//   shared       519 B →    520 B (types and constants, including the slow-consumer reason)
//   react      2,817 B →  2,847 B (the resume parameter: the last event id the hook saw, replacing one
//     the url already carries, before any fragment, and the helpers of the two hooks, which stay
//     within the 50-line function limit through a context object for 11 members that carries the state
//     and refs, 333 B, measured on 2026-11-17)
//
// What an SSE application pays on the server is `server` + `internal`, since the
// root imports the shared runtime rather than inlining it: two bundles, one
// identity for the classes and `Symbol`s used as injection tokens. `websocket`
// is what the Socket.IO transport adds on top, and only for those who import it.
//
// These are ratchets, deliberately far below the architectural ceiling for the
// SSE-only React bundle (4 KiB brotli — see CLAUDE.md). Raise a ratchet only for
// code that has to exist; the ceiling is what must never move.
const BUDGETS = [
  { name: 'server (root facade)', path: 'dist/server/index.mjs', brotli: 265 },
  { name: 'internal (shared runtime, SSE)', path: 'dist/internal/index.mjs', brotli: 26_782 },
  { name: 'websocket (Socket.IO transport)', path: 'dist/websocket/index.mjs', brotli: 8_537 },
  {
    name: 'observability (metrics contributor)',
    path: 'dist/observability/index.mjs',
    brotli: 1_122,
  },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 520 },
  { name: 'react (hooks + provider, SSE-only base)', path: 'dist/react/index.mjs', brotli: 2_847 },
]

// The Socket.IO stack must not be reachable from anything an SSE application
// loads. It is the whole reason the transports are split across entry points,
// and a stray import puts it back into every install without failing anything.
const SSE_ONLY_BUNDLES = [
  'dist/server/index.mjs',
  'dist/server/index.cjs',
  'dist/internal/index.mjs',
  'dist/internal/index.cjs',
]
const SOCKET_IO_TOKENS = ['@nestjs/websockets', '@nestjs/platform-socket.io', 'socket.io']
// The optional peers only the observability entry may name: an application that publishes no metrics does
// not install them, so a static import in the root or the shared runtime would make the package unimportable.
const OBSERVABILITY_PEER_TOKENS = ['@bymax-one/nest-core', 'prom-client', '@opentelemetry/api']

const FORBIDDEN_STATIC = [
  { path: 'dist/react/index.mjs', token: 'socket.io-client' },
  ...SSE_ONLY_BUNDLES.flatMap((path) =>
    [...SOCKET_IO_TOKENS, ...OBSERVABILITY_PEER_TOKENS].map((token) => ({ path, token })),
  ),
]

// The mirror image: the entry points must *reach* the shared runtime rather than
// inline it. A copied class or `Symbol` is a different injection token, so a
// bundle that stopped importing this specifier is one that silently gave the
// consumer two containers' worth of identities. `check:runtime` proves the
// consequence; this catches the cause at build time, in a second.
const REQUIRED_STATIC = [
  'dist/server/index.mjs',
  'dist/server/index.cjs',
  'dist/websocket/index.mjs',
  'dist/websocket/index.cjs',
  'dist/observability/index.mjs',
  'dist/observability/index.cjs',
].map((path) => ({ path, token: '@bymax-one/nest-realtime/internal' }))

function brotliSize(buffer) {
  return brotliCompressSync(buffer, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
  }).length
}

function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(2)} KB`
}

let failed = false

for (const budget of BUDGETS) {
  const absolute = join(rootDir, budget.path)
  if (!existsSync(absolute)) {
    console.error(`✗ MISSING  ${budget.name} — expected ${budget.path} (run \`pnpm build\` first)`)
    failed = true
    continue
  }
  const size = brotliSize(readFileSync(absolute))
  const within = size <= budget.brotli
  const status = within ? '✓ OK    ' : '✗ OVER  '
  console.log(
    `${status} ${budget.name}: ${formatBytes(size)} brotli (budget ${formatBytes(budget.brotli)})`,
  )
  if (!within) failed = true
}

// Match a STATIC import/require of the token — `import "x"`, `... from "x"`,
// `require("x")` — but NOT the allowed dynamic `import("x")` (it has a parenthesis,
// not a quote, after `import`). Otherwise the gate would false-flag the dynamic form.
function staticImportRegex(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*)['"]${escaped}['"]`)
}

for (const rule of FORBIDDEN_STATIC) {
  const absolute = join(rootDir, rule.path)
  if (!existsSync(absolute)) continue
  const contents = readFileSync(absolute, 'utf8')
  if (staticImportRegex(rule.token).test(contents)) {
    console.error(
      `✗ STATIC IMPORT  ${rule.path} statically references "${rule.token}" — it must be a dynamic import only`,
    )
    failed = true
  } else {
    console.log(`✓ OK     ${rule.path} contains no static "${rule.token}" reference`)
  }
}

for (const rule of REQUIRED_STATIC) {
  const absolute = join(rootDir, rule.path)
  if (!existsSync(absolute)) continue
  const contents = readFileSync(absolute, 'utf8')
  if (staticImportRegex(rule.token).test(contents)) {
    console.log(`✓ OK     ${rule.path} imports "${rule.token}" instead of inlining it`)
  } else {
    console.error(
      `✗ INLINED  ${rule.path} does not import "${rule.token}" — the shared runtime was copied into this bundle, giving its classes and \`Symbol\`s a second identity`,
    )
    failed = true
  }
}

// An ES module has no `require`. A bundler turns `require(...)` in source into `__require(...)`,
// which throws when the bundle loads as ESM, so a call is allowed only where the bundle declares a
// real `require`.
const esmFiles = readdirSync(join(rootDir, 'dist'), { recursive: true })
  .filter((name) => String(name).endsWith('.mjs'))
  .map(String)
let undeclaredRequire = false
for (const name of esmFiles) {
  const contents = readFileSync(join(rootDir, 'dist', name), 'utf8')
  if (/__require\(/.test(contents) && !/createRequire\(import\.meta\.url\b/.test(contents)) {
    console.error(
      `✗ DYNAMIC REQUIRE  dist/${name} calls \`__require(\` without declaring a \`require\`: in ESM it throws`,
    )
    failed = true
    undeclaredRequire = true
  }
}
if (!undeclaredRequire)
  console.log(`✓ OK     ${esmFiles.length} ESM bundles call no undeclared \`require\``)

if (failed) {
  console.error('\nBundle-size gate FAILED.')
  process.exit(1)
}
console.log('\nBundle-size gate passed.')
