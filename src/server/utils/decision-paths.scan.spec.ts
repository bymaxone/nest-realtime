/**
 * @fileoverview Every server-side file (`src/server`, `src/websocket`, `src/internal`, `src/observability`) waits on a host value only through the helpers, bar the sites listed here
 * with the reason nobody decides on them.
 * @layer utils
 *
 * Constraint under test: a decision that reads what a host call answered must not go through `Promise.race`,
 * `Promise.resolve`, a `then`, `for await` or an `await` of a host value that was not shielded first, because each reads
 * a slot a host can replace. A file added later is covered the moment it exists: a site it adds that is not listed
 * fails here, and the listing is the place to say why it is safe.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Source {
  readonly path: string
  readonly source: string
}

const src = join(__dirname, '..', '..')
// The browser entries (`react`, `shared`) run where no host supplies a store, a bus or a tracer, so they are not scanned.
const ROOTS = ['server', 'websocket', 'internal', 'observability'] as const

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

// Code a host supplies, or that a host's tracer or hook runs inside: after it, the engine's read of `then` on a returned
// object is the first thing that can see what it planted.
const HOST_RUN =
  /\battempt\(|\.end\(|\brunHook\(|reportDeliveryFailure\(|\bthis\.hooks\b|\bhooks\??\.\w+\(|\bthis\.tracing\b|\bonExpire\b/

// What an async function may return without being checked: nothing, a primitive literal, or the result of the helper that
// asserts the built-ins and refuses a value with a `then` anywhere on its chain.
const CHECKED_RETURN =
  /^(?:returnable\(|unboxed\(|[\w.]+ \? undefined : unboxed\(|undefined\b|null\b|true\b|false\b|void\b|\d|['"`])/

/** The body that starts at `open`, without a nested function's own body. */
function bodyFrom(text: string, open: number): string {
  let depth = 1
  let end = open
  while (end < text.length && depth > 0) {
    depth += (text[end] === '{' ? 1 : 0) - (text[end] === '}' ? 1 : 0)
    end += 1
  }
  return text.slice(open, end - 1)
}

const withoutNested = (body: string): string => {
  let out = body
  for (
    let m = /(?:=>|\bfunction\b[^{]*)\s*\{/.exec(out);
    m;
    m = /(?:=>|\bfunction\b[^{]*)\s*\{/.exec(out)
  ) {
    const open = m.index + m[0].length
    out = out.slice(0, m.index) + out.slice(open + bodyFrom(out, open).length + 1)
  }
  return out
}

/**
 * Every `return` of an async function, other than the checked forms, in a function that ran host code before it. Such a
 * return resolves the function's promise with an object, which asks it for a `then` after the host code has run.
 */
function uncheckedReturns({ source }: Source): string[] {
  const text = bare(source)
  const found: string[] = []
  for (const m of text.matchAll(/\basync\b[^{;]*?\{/g)) {
    const body = withoutNested(bodyFrom(text, m.index + m[0].length))
    if (!HOST_RUN.test(body)) continue
    for (const line of body.split('\n')) {
      const ret = /^\s*return\s+(.+)$/.exec(line)
      if (ret && !CHECKED_RETURN.test(ret[1] ?? '')) found.push(`return ${(ret[1] ?? '').trim()}`)
    }
  }
  return found.sort()
}

/** Every source under the server-side roots that ships: not a spec and not a declaration, as a path under `src`. */
function shippedSources(): Source[] {
  return ROOTS.flatMap((dir) =>
    existsSync(join(src, dir))
      ? (readdirSync(join(src, dir), { recursive: true }) as string[]).map(
          (file) => `${dir}/${String(file)}`,
        )
      : [],
  )
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .sort()
    .map((path) => ({ path, source: readFileSync(join(src, path), 'utf8') }))
}

type Site = readonly [site: string, reason: string]

// Each entry is one site, with the reason nobody decides on it. Two of the same site are two entries. A site a file gains
// that is not here, or one more of the same, fails the row of that file.
const OWN_AWAIT =
  "awaits the library's own async method, whose own returns are checked where it returns"
const EXEMPT: Record<string, readonly Site[]> = {
  'server/utils/within-deadline.ts': [
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
  'server/utils/builtin-baseline.ts': [
    [
      "['then']",
      'names the key for an own-property check through the captured function; the property is not read, so no `then` runs',
    ],
  ],
  'server/utils/assert-identity.ts': [
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
  'server/services/authentication-gate.service.ts': [],
  'server/services/reauthentication.service.ts': [
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
  'server/offline-queue/offline-queue-delivery.service.ts': [
    [
      'await this.storage.acknowledge',
      'a host store call whose answer is never read: acknowledging is not a decision',
    ],
  ],
  'server/offline-queue/redis-offline-queue.ts': [
    [
      'await pipeline.exec',
      "a Redis pipeline the library built: the reply is the store's own, parsed by the library and bounded by the reader",
    ],
    [
      'await this.#client.zrangebylex',
      "the store's Redis client, called from `retrieveSince`: the delivery service bounds that whole call with `withinDeadline` and checks the built-ins before it; the reply is parsed here, not decided on",
    ],
    [
      'await this.#client.zrangebylex',
      'the members `acknowledge` removes: no answer is decided on, and nothing here bounds the call',
    ],
    ['await this.#client.zrem', 'trimming the store; no answer is read'],
  ],
  'server/config/guard-host-reads.ts': [
    ['Promise.resolve', 'boot-time read of a host factory, outside the guard'],
    ['then.call', 'boot-time read of a host factory, outside the guard'],
    ['newPromise', "adapts the host factory's callback at boot, outside the guard"],
  ],
  'server/composition/realtime-module.factory.ts': [
    [
      'await awaitHostResult',
      'boot-time read of a host factory; the options it returns are validated after it, against the baseline',
    ],
    [
      'await awaitHostResult',
      'boot-time read of a host factory; the options it returns are validated after it, against the baseline',
    ],
  ],
  'server/observability/realtime-tracing.ts': [
    ['.catch(', 'swallows what a tracer rejects with; no answer is read'],
    ['Promise.resolve', 'wraps a tracer call whose answer is dropped'],
    ['await import', 'loads the optional tracing package; the module is not a decision'],
    ['await run', 'runs the operation the span wraps; the span does not read its answer'],
  ],
  'server/pubsub/in-memory-pubsub.ts': [
    ['Promise.resolve', 'defers delivery one microtask; carries no value'],
    ['await Promise.resolve', 'defers delivery one microtask; carries no value'],
  ],
  'server/pubsub/realtime-pubsub-subscriber.ts': [
    ['.catch(', 'logs a remote disconnect that failed; the connection is already being closed'],
    ['Promise.resolve', "wraps a synchronous handler's possible rejection; the answer is dropped"],
    [
      'await this.pubsub.subscribe',
      'the bus subscription at boot: availability, not identity or admission',
    ],
    ['await this.unsubscribe', OWN_AWAIT],
  ],
  'server/pubsub/redis-realtime-pubsub.ts': [
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
    ['await this.ensureSubscriber', OWN_AWAIT],
    ['await this.publisherSettled', OWN_AWAIT],
    ['await quitWithin', 'closes a client on shutdown; the answer is not read'],
    [
      'await first',
      'the subscribe confirmation, awaited after it was shielded and absorbed by the negotiation',
    ],
  ],
  'server/utils/quit-within.ts': [
    ['newPromise', 'the shutdown bound for a client close; the answer is not read'],
    ['.then(', 'closes a client on shutdown; the answer is not read'],
    ['Promise.race', 'closes a client on shutdown; the answer is not read'],
    ['await Promise.race', 'closes a client on shutdown; the answer is not read'],
  ],
  'server/utils/report-delivery-failure.ts': [
    ['.catch(', 'logs a hook that failed; the hook runs after the decision'],
    ['.then(', "calls the host's onDeliveryFailure hook after the decision"],
    ['Promise.resolve', 'starts the hook call off the current turn; carries no value'],
  ],
  'server/utils/run-hook.ts': [
    ['newPromise', 'the hook timeout; a hook failure is logged, never decided on'],
    ['Promise.race', 'runs a hook whose failure is logged, never decided on'],
    ['await invoke', 'a lifecycle hook whose failure is logged, never decided on'],
    ['await run', 'a lifecycle hook whose failure is logged, never decided on'],
    ['await Promise.race', 'a lifecycle hook whose failure is logged, never decided on'],
  ],
  'server/utils/semaphore.ts': [
    ['newPromise', 'a waiter for a free slot; carries no value'],
    ['await new Promise<void>', 'a waiter for a free slot; carries no value'],
    ['await task', 'a task the library queued; its own answer is read by its own caller'],
  ],
  'server/transports/sse/sse-subscription.handler.ts': [
    ['.then(', 'logs a failed lifecycle hook; the hook runs after the decision'],
    [
      'await this.transport.authenticate',
      "the gate's own method, which reads the host through the helpers and checks what it returns",
    ],
    ['await registering', 'the registration promise, shielded and absorbed where it was made'],
  ],
  'server/transports/sse/sse.transport.ts': [
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
    ['await this.tryPublish', OWN_AWAIT],
  ],
  'websocket/transports/composite/composite.transport.ts': [
    [
      'Promise.allSettled',
      'fanOut: the failures it collects only choose between throwing to the emitter and logging; no identity, admission or replay is read. Tracked, not fixed here',
    ],
    [
      'Promise.allSettled',
      'settleBoth: reports a room change or a revocation that failed on a library transport; a replaced `Promise.allSettled` could report a failed one as done. Tracked, not fixed here',
    ],
    ['await Promise.allSettled', 'fanOut above'],
    ['await Promise.allSettled', 'settleBoth above'],
    ['await this.fanOut', OWN_AWAIT],
    ['await this.fanOut', OWN_AWAIT],
    ['await this.fanOut', OWN_AWAIT],
    ['await this.fanOut', OWN_AWAIT],
    ['await this.settleBoth', OWN_AWAIT],
    ['await this.settleBoth', OWN_AWAIT],
    ['await this.settleBoth', OWN_AWAIT],
  ],
  'websocket/transports/websocket/realtime-io-adapter.ts': [
    ['.catch(', 'closes a server whose boot failed; the boot error is what is thrown'],
    [
      '.catch(',
      'closes a server whose adapter could not be installed; the error is what is thrown',
    ],
    [
      '.catch(',
      'logs a rejection of a subscriber command the Socket.IO adapter discards; it admits nothing',
    ],
    ['Promise.allSettled', 'disposal: waits for the subscribers to quit; no answer is read'],
    [
      'Promise.resolve',
      'wraps the discarded command promise so its rejection is logged; it reads no answer',
    ],
    ['await Promise.allSettled', 'disposal above'],
    ['await super.dispose', "the framework's own shutdown; no answer is read"],
  ],
  'websocket/transports/websocket/realtime.gateway.ts': [
    [
      'await (this.tracing',
      "the handshake inside its span: the outcome is read from the variable the handshake sets, never from the span's return",
    ],
    ['await registering', "the library's own registration promise; it resolves with nothing"],
    ['await this.handshake', OWN_AWAIT],
    ['await this.takeHandshake', OWN_AWAIT],
    [
      'await this.transport.authenticate',
      "the transport's own method, which reads the host through the helpers and checks what it returns",
    ],
    [
      'await this.transport.authenticate',
      "the transport's own method, which reads the host through the helpers and checks what it returns",
    ],
    ['await this.transport.unregisterSocket', OWN_AWAIT],
  ],
  'websocket/transports/websocket/websocket.transport.ts': [
    [
      'await runHook',
      'a lifecycle hook whose failure closes the connection it already admitted; no identity is read',
    ],
    [
      'await socket.join',
      'Socket.IO adds the socket to a room after the built-ins are checked; no answer is read',
    ],
    [
      'await socket.leave',
      'Socket.IO removes the socket from a room; the built-ins are checked after it and before the library records the leave',
    ],
    ['await this.disconnect', OWN_AWAIT],
    ['await this.evictBeyondLimit', OWN_AWAIT],
    ['await this.joinRooms', OWN_AWAIT],
    ['await this.joinSocket', OWN_AWAIT],
    ['await this.joinSocket', OWN_AWAIT],
    ['await this.joinSocket', OWN_AWAIT],
    ['await this.joinSocket', OWN_AWAIT],
    ['await this.joinSocket', OWN_AWAIT],
    ['await this.runOnConnect', OWN_AWAIT],
    ['await this.unregisterSocket', OWN_AWAIT],
  ],
  'server/services/realtime.service.ts': [
    ['await this.transport.disconnect', "the library's own transport; no answer is read"],
  ],
  'server/factories/sse-controller.factory.ts': [
    [
      'await this.handler.authenticateBeforeCommit',
      "the handler's own method, which reads the gate and checks what it returns",
    ],
  ],
}

describe('every server-side file that ships', () => {
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

  // Scenario: the shapes that decide the rule. Expected: an object returned after host code ran is found; a checked return,
  // a primitive, and a function that ran no host code are not.
  it.each([
    ['async f() {\n  span.end()\n  return result\n}', ['return result']],
    ['async f() {\n  attempt(() => 1)\n  return { a: 1 }\n}', ['return { a: 1 }']],
    ['async f() {\n  span.end()\n  return returnable(result)\n}', []],
    ['async f() {\n  span.end()\n  return unboxed(box)\n}', []],
    ['async f() {\n  span.end()\n  return undefined\n}', []],
    ['async f() {\n  span.end()\n  return quiet ? undefined : unboxed(box)\n}', []],
    ['async f() {\n  return result\n}', []],
    ['async f() {\n  run(() => {\n    return x\n  })\n  span.end()\n  return 1\n}', []],
  ])('finds the unchecked returns of %s', (source, expected) => {
    expect(uncheckedReturns({ path: 'x.ts', source })).toEqual(expected)
  })

  // Scenario: the tree on disk. Expected: no async function that ran host code returns an object without the check.
  it('no shipped file returns an unchecked object after host code ran', () => {
    expect(
      shippedSources().flatMap((source) =>
        uncheckedReturns(source).map((r) => `${source.path}: ${r}`),
      ),
    ).toEqual([])
  })

  // Scenario: a file that is new, with an await of a host call that nothing shielded, and no entry for it. Expected: the
  // file's sites are not the listed ones, so its row would fail; and a file that is not listed at all has none to match.
  it('a new file with a bare host await has sites that are not listed', () => {
    const added: Source = {
      path: 'server/transports/new-transport.ts',
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
