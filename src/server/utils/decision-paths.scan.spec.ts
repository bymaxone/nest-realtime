/**
 * @fileoverview Every file under `src/server` waits on a host value only through the helpers, bar the sites listed here
 * with the reason nobody decides on them.
 * @layer utils
 *
 * Constraint under test: a decision that reads what a host call answered must not go through `Promise.race`,
 * `Promise.resolve`, a `then`, `for await` or an `await` of a host value that was not shielded first, because each reads
 * a slot a host can replace. A file added later is covered the moment it exists: a site it adds that is not listed
 * fails here, and the listing is the place to say why it is safe.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Source {
  readonly path: string
  readonly source: string
}

const root = join(__dirname, '..')

const bare = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// A Promise static by dot or by bracket, a destructured one, a promise built with `new`, `then`, `catch` and `finally`
// called on something, `then` called through `call`, `apply` or `bind`, and `for await`. Whitespace inside a match is not
// part of it.
const FOUND =
  /\bnew\s+Promise\b|\bPromise\s*(?:\.\s*\w+|\[\s*['"`]\w+['"`]\s*\])|\{[^}]*\}\s*=\s*Promise\b|\.\s*(?:then|catch|finally)\s*\(|\bthen\s*\.\s*(?:call|apply|bind)|\[\s*['"`](?:then|catch|finally)['"`]\s*\]|\bfor\s+await\b/g

// A return of a call on something the host supplied: an async function that returns it resolves with it, and asks it for
// a `then`. The members are the ones the library holds a host's object in.
const HOST_RETURN =
  /\breturn\s+(?:await\s+)?(?:this\.#?(?:client|storage|pubsub|authenticator|tracing)|queue|storage|pubsub|authenticator)(?:\??\.#?\w+)*\s*\(/g

// The helpers whose result is what an await may take: each shields what it is given, or is the library's own wait.
const HELPERS = /^(?:shielded|awaitable|withinDeadline|firstOf|absorbed)$/

/** What an `await` waits for, cut at the first call or index: the callee, or the variable. */
const awaitedOf = (operand: string): string =>
  operand.startsWith('(') ? operand.slice(0, 24) : (operand.split(/[(,)[]/)[0] ?? '').trim()

/**
 * Every site of a source that reads something a host can replace, as a sorted list of what it is: a matched form, `await
 * <callee>` for an await that is not of a helper, and `return <host member>`.
 */
function sitesIn({ source }: Source): string[] {
  const text = bare(source)
  const found = (text.match(FOUND) ?? []).map((site) => site.replace(/\s+/g, ''))
  const awaited = [...text.matchAll(/(?<!\bfor\s)\bawait\s+([^\n]*)/g)]
    .map((site) => awaitedOf((site[1] ?? '').trim()))
    .filter((callee) => !HELPERS.test(callee))
    .map((callee) => `await ${callee}`)
  const returned = (text.match(HOST_RETURN) ?? []).map((site) => site.replace(/\s+/g, ' '))
  return [...found, ...awaited, ...returned].sort()
}

/** Every source under `src/server` that ships: not a spec and not a declaration. */
function shippedSources(): Source[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .sort()
    .map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }))
}

type Site = readonly [site: string, reason: string]

// Each entry is one site, with the reason nobody decides on it. Two of the same site are two entries. A site a file gains
// that is not here, or one more of the same, fails the row of that file.
const OWN_AWAIT =
  "awaits the library's own async method, whose own returns are checked where it returns"
const EXEMPT: Record<string, readonly Site[]> = {
  'utils/within-deadline.ts': [
    [
      "['then']",
      'names the slot for an own-property check on a host result; the property is not read, so no `then` runs',
    ],
    [
      'await call',
      'the call was given its own constructor above, so the await reads no slot and asks for no `then`',
    ],
    ['await call', 'a promise this module made, whose constructor is its own'],
    ['await call', 'a promise this module made, whose constructor is its own'],
  ],
  'utils/builtin-baseline.ts': [
    [
      "['then']",
      'names the key for an own-property check through the captured function; the property is not read, so no `then` runs',
    ],
  ],
  'utils/assert-identity.ts': [
    [
      '.catch(',
      'the last way to a handler for a discarded promise that is not one by brand; it reads no answer',
    ],
    [
      'Promise.prototype',
      'the intrinsic `then`, which accepts only a real promise and attaches a handler that reads nothing',
    ],
    ['then.call', 'the intrinsic `then` called on a discarded promise; it reads no answer'],
  ],
  'services/authentication-gate.service.ts': [],
  'services/reauthentication.service.ts': [
    ['.catch(', 'the interval tick logs a cycle that threw; no answer is read'],
    [
      'Promise.all',
      'waits for every check to finish; the checks decide, and each reads its own answer',
    ],
    ['.then(', 'logs a hook failure; the hook runs after the decision'],
    ['.catch(', 'reports a failure of the failure event; the disconnect is not waiting for it'],
    [
      'await Promise.all',
      'waits for every check, each of which reads its own answer through the helpers',
    ],
    [
      'await (this.tracing ? this.tra',
      "a span around the cycle: the tracer sees the run, and its return is the run's own",
    ],
    [
      'await this.slots.run',
      'a slot for one check; the check reads its own answer through the helpers',
    ],
    ['await this.bounded', "the library's bounded wait, which reads through the helpers"],
    ['await this.revoke', OWN_AWAIT],
    ['await this.revoke', OWN_AWAIT],
    ['await this.bounded', "the library's bounded wait, which reads through the helpers"],
    ['await this.realtime.disconnect', "the library's own disconnect; no answer is read"],
  ],
  'offline-queue/offline-queue-delivery.service.ts': [
    [
      'await this.storage.acknowledge',
      'a host store call whose answer is never read: acknowledging is not a decision',
    ],
  ],
  'offline-queue/redis-offline-queue.ts': [
    [
      'await pipeline.exec',
      "a Redis pipeline the library built: the reply is the store's own, parsed by the library and bounded by the reader",
    ],
    [
      'await this.#client.zrangebylex',
      "the store's Redis client; the reader bounds it with `withinDeadline`",
    ],
    [
      'await this.#client.zrangebylex',
      "the store's Redis client; the reader bounds it with `withinDeadline`",
    ],
    ['await this.#client.zrem', 'trimming the store; no answer is read'],
  ],
  'config/guard-host-reads.ts': [
    ['Promise.resolve', 'boot-time read of a host factory, outside the guard'],
    ['then.call', 'boot-time read of a host factory, outside the guard'],
    ['newPromise', "adapts the host factory's callback at boot, outside the guard"],
  ],
  'composition/realtime-module.factory.ts': [
    [
      'await awaitHostResult',
      'boot-time read of a host factory; the options it returns are validated after it, against the baseline',
    ],
    [
      'await awaitHostResult',
      'boot-time read of a host factory; the options it returns are validated after it, against the baseline',
    ],
  ],
  'observability/realtime-tracing.ts': [
    ['.catch(', 'swallows what a tracer rejects with; no answer is read'],
    ['Promise.resolve', 'wraps a tracer call whose answer is dropped'],
    ['await import', 'loads the optional tracing package; the module is not a decision'],
    ['await run', 'runs the operation the span wraps; the span does not read its answer'],
  ],
  'pubsub/in-memory-pubsub.ts': [
    ['Promise.resolve', 'defers delivery one microtask; carries no value'],
    ['await Promise.resolve', 'defers delivery one microtask; carries no value'],
  ],
  'pubsub/realtime-pubsub-subscriber.ts': [
    ['.catch(', 'logs a remote disconnect that failed; the connection is already being closed'],
    ['Promise.resolve', "wraps a synchronous handler's possible rejection; the answer is dropped"],
    [
      'await this.pubsub.subscribe',
      'the bus subscription at boot: availability, not identity or admission',
    ],
    ['await this.unsubscribe', OWN_AWAIT],
  ],
  'pubsub/redis-realtime-pubsub.ts': [
    [
      'Promise.race',
      'the publish deadline: a late or lost publish is counted by its own path, not decided by it',
    ],
    [
      'newPromise',
      'the publish deadline timer: rejects with a fresh error, raced only by the publish wait',
    ],
    ['.catch(', 'a connect started in the background; its failure is retried, not read'],
    ['newPromise', 'waits for a connecting publisher to settle before the quit; carries no value'],
    [
      'newPromise',
      'the unreachable operand of the subscribe negotiation: resolved with a box it makes, read only through firstOf',
    ],
    ['Promise.resolve', 'returns at once when the connection is already up; carries no value'],
    ['.catch(', 'a refusal after boot marks the bus unsubscribed and logs; it admits nothing'],
    [
      '.then(',
      'a confirmation after boot marks the bus up or refused: availability state, not identity or admission',
    ],
    ['await Promise.race', 'the publish deadline above'],
    ['await this.ensureSubscriber', OWN_AWAIT],
    ['await this.publisherSettled', OWN_AWAIT],
    ['await quitWithin', 'closes a client on shutdown; the answer is not read'],
    [
      'await first',
      'the subscribe confirmation, awaited after it was shielded and absorbed by the negotiation',
    ],
  ],
  'utils/quit-within.ts': [
    ['newPromise', 'the shutdown bound for a client close; the answer is not read'],
    ['.then(', 'closes a client on shutdown; the answer is not read'],
    ['Promise.race', 'closes a client on shutdown; the answer is not read'],
    ['await Promise.race', 'closes a client on shutdown; the answer is not read'],
  ],
  'utils/report-delivery-failure.ts': [
    ['.catch(', 'logs a hook that failed; the hook runs after the decision'],
    ['.then(', "calls the host's onDeliveryFailure hook after the decision"],
    ['Promise.resolve', 'starts the hook call off the current turn; carries no value'],
  ],
  'utils/run-hook.ts': [
    ['newPromise', 'the hook timeout; a hook failure is logged, never decided on'],
    ['Promise.race', 'runs a hook whose failure is logged, never decided on'],
    ['await invoke', 'a lifecycle hook whose failure is logged, never decided on'],
    ['await run', 'a lifecycle hook whose failure is logged, never decided on'],
    ['await Promise.race', 'a lifecycle hook whose failure is logged, never decided on'],
  ],
  'utils/semaphore.ts': [
    ['newPromise', 'a waiter for a free slot; carries no value'],
    ['await new Promise<void>', 'a waiter for a free slot; carries no value'],
    ['await task', 'a task the library queued; its own answer is read by its own caller'],
  ],
  'transports/sse/sse-subscription.handler.ts': [
    ['.then(', 'logs a failed lifecycle hook; the hook runs after the decision'],
    [
      'await this.transport.authenticate',
      "the gate's own method, which reads the host through the helpers and checks what it returns",
    ],
    ['await registering', 'the registration promise, shielded and absorbed where it was made'],
  ],
  'transports/sse/sse.transport.ts': [
    ['Promise.all', 'shutdown: waits for every connection to be cut'],
    [
      'Promise.all',
      'emitToUser: the failures it collects only choose between throwing to the emitter and logging; no identity, admission or replay is read. Tracked, not fixed here',
    ],
    ['.catch(', 'logs a disconnect that failed; the connection is already being closed'],
    ['await Promise.all', 'shutdown above'],
    ['await Promise.all', 'emitToUser above'],
    ['await this.beforeApplicationShutdown', OWN_AWAIT],
    ['await this.evictBeyondLimit', OWN_AWAIT],
    ['await this.notifyDisconnect', OWN_AWAIT],
    ['await this.notifyDisconnect', OWN_AWAIT],
    ['await runHook', 'a lifecycle hook whose failure is logged, never decided on'],
    ['await queue.append', 'a host store call that records an event for later; no answer is read'],
    ['await this.publish', OWN_AWAIT],
    ['await this.publish', OWN_AWAIT],
    ['await this.publish', OWN_AWAIT],
    ['await this.disconnectLocal', OWN_AWAIT],
    ['await this.disconnectLocal', OWN_AWAIT],
    [
      'await this.pubsub.publish',
      'a host bus call whose answer is never read: publishing is not a decision',
    ],
    [
      'await this.pubsub.publish',
      'a host bus call whose answer is never read: publishing is not a decision',
    ],
    ['await this.tryPublish', OWN_AWAIT],
  ],
  'services/realtime.service.ts': [
    ['await this.transport.disconnect', "the library's own transport; no answer is read"],
  ],
  'factories/sse-controller.factory.ts': [
    [
      'await this.handler.authenticateBeforeCommit',
      "the handler's own method, which reads the gate and checks what it returns",
    ],
  ],
}

describe('every file under src/server that ships', () => {
  // Scenario: forms a scan that matched only `Promise.race` and `.then(` would miss. Expected: each is found.
  it.each([
    ["Promise['race'](x)", ["Promise['race']"]],
    ['const { race } = Promise', ['{race}=Promise']],
    ['Promise.try(f)', ['Promise.try']],
    ['Promise.withResolvers()', ['Promise.withResolvers']],
    ['p.catch(f)', ['.catch(']],
    ['p.finally(f)', ['.finally(']],
    ['then.call(p, f)', ['then.call']],
    ['p.then (f)', ['.then(']],
    ['p["then"]', ['["then"]']],
    ['new Promise((resolve) => resolve())', ['newPromise']],
    ['new  Promise<void>(f)', ['newPromise']],
    ['for await (const x of y) f(x)', ['forawait']],
    ['await this.storage.read(id)', ['await this.storage.read']],
    ['await x', ['await x']],
    ['await shielded(x)', []],
    ['await awaitable(x)', []],
    ['await withinDeadline(a, 1)', []],
    ['await firstOf(a, b)', []],
    ['await absorbed(a)', []],
    ['return this.storage.read(id)', ['return this.storage.read(']],
    [
      'return await this.pubsub.publish(m)',
      ['await this.pubsub.publish', 'return await this.pubsub.publish('],
    ],
    ['// Promise.race(x) /* p.then(f) */ // await this.storage.read()', []],
  ])('finds %s', (source, expected) => {
    expect(sitesIn({ path: 'x.ts', source })).toEqual(expected)
  })

  // Scenario: a file that is new, with an await of a host call that nothing shielded, and no entry for it. Expected: the
  // file's sites are not the listed ones, so its row would fail; and a file that is not listed at all has none to match.
  it('a new file with a bare host await has sites that are not listed', () => {
    const added: Source = {
      path: 'transports/new-transport.ts',
      source:
        'export async function f(s: Store) {\n  return (await s.load()).id\n}\nasync function g(h: Host) {\n  await h.authenticate()\n}\n',
    }

    expect(sitesIn(added)).toEqual(['await h.authenticate', 'await s.load'])
    expect(EXEMPT[added.path] ?? []).toEqual([])
  })

  // Scenario: the tree on disk. Expected: every file the listing names still exists, so an entry for a file that was
  // removed or renamed does not stay behind to excuse a site of another.
  it('lists no file that is gone', () => {
    expect(shippedSources().map((source) => source.path)).toEqual(
      expect.arrayContaining(Object.keys(EXEMPT)),
    )
  })

  // Scenario: each file is read with its comments taken out. Expected: its sites are exactly the listed ones, so a new
  // site, or one more of the same, fails here with the file named.
  it.each(shippedSources().map((source) => [source.path, source] as const))(
    '%s reads a host value only through the helpers, bar its listed sites',
    (path, source) => {
      expect(sitesIn(source)).toEqual((EXEMPT[path] ?? []).map((site) => site[0]).sort())
    },
  )
})
