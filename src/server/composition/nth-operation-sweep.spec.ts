/**
 * @fileoverview Every read of an object the host hands over, failing in turn, ends in a library error that carries the host's error.
 * @layer composition
 *
 * Each host object a public call reads is wrapped in a proxy whose Nth trap throws the host's own error; N is
 * looped from 1 until a call completes without reaching its Nth trap, so every operation the call performs on
 * the object is tried once. An operation may be harmless (the call completes) or fail, and a failure has to be
 * a library error, with its stable code, holding the host's error as its cause. The host's raw error, an
 * engine error such as a `TypeError`, and a library error without the cause are all defects.
 */
import { Test } from '@nestjs/testing'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { BymaxRealtimeModule } from '../realtime.module'

const CODES: ReadonlySet<unknown> = new Set(Object.values(REALTIME_ERROR_CODES))
const MAX_OPERATIONS = 500

/** A valid options object with a value in each group the validation reads. */
const optionsOf = (): Record<string, unknown> => ({
  transport: 'sse',
  authenticator: { authenticate: async () => null, revalidate: async () => null },
  sse: { endpoint: '/events', heartbeatMs: 15_000 },
  hooks: { onConnect: () => undefined, onDisconnect: () => undefined },
  reauthenticationPolicy: { intervalSeconds: 60, cacheTtlMs: 30_000 },
})

/** A registration with a synchronous factory, which is what the module reads before any provider is built. */
const registrationOf = (): Record<string, unknown> => ({
  transport: 'sse',
  sseEndpoint: '/stream',
  useFactory: () => optionsOf(),
  inject: [],
  imports: [],
  extraProviders: [],
})

/** The object, with its Nth operation (counted across it and everything read from it) throwing `host`. */
function failingAt(
  target: object,
  n: number,
  host: Error,
  plain: readonly string[],
): { proxy: object; reached: () => boolean } {
  let operations = 0
  const trap = (): void => {
    operations += 1
    if (operations === n) throw host
  }
  const wrap = (object: object): object =>
    new Proxy(object, {
      get(t, key, receiver) {
        trap()
        const value = Reflect.get(t, key, receiver) as unknown
        const kept = typeof key === 'string' && plain.includes(key)
        return typeof value === 'object' && value !== null && !kept ? wrap(value) : value
      },
      has: (t, key) => (trap(), Reflect.has(t, key)),
      ownKeys: (t) => (trap(), Reflect.ownKeys(t)),
      getOwnPropertyDescriptor: (t, key) => (trap(), Reflect.getOwnPropertyDescriptor(t, key)),
      getPrototypeOf: (t) => (trap(), Reflect.getPrototypeOf(t)),
    })
  return { proxy: wrap(target), reached: () => operations >= n }
}

/** What a call that was given the failing object did: nothing wrong, or a defect described in words. */
async function outcomeOf(call: () => unknown, host: Error): Promise<string> {
  try {
    await call()
    return 'completed'
  } catch (error) {
    if (error === host) return 'the host error, raw'
    const code = (error as { code?: unknown } | null)?.code
    if (!CODES.has(code))
      return `an error that is not the library's: ${String((error as Error)?.message)}`
    return (error as Error).cause === host
      ? 'completed'
      : 'a library error without the host error as its cause'
  }
}

/** Loops N from 1 and collects every defect, until a call completes without reaching its Nth operation. */
async function sweep(
  make: () => object,
  run: (host: object) => unknown,
  plain: readonly string[] = [],
): Promise<{ operations: number; defects: string[] }> {
  const defects: string[] = []
  for (let n = 1; n <= MAX_OPERATIONS; n += 1) {
    const host = new Error(`host-error-${n}`)
    const { proxy, reached } = failingAt(make(), n, host, plain)
    const outcome = await outcomeOf(() => run(proxy), host)
    if (outcome !== 'completed') defects.push(`operation ${n}: ${outcome}`)
    if (!reached()) return { operations: n - 1, defects }
  }
  throw new Error(`the call still reached operation ${MAX_OPERATIONS}`)
}

describe('the operations on a host object, each failing in turn', () => {
  // Scenario: the options of forRoot. Expected: no operation ends in a raw or foreign error.
  it('forRoot reads the options', async () => {
    const { operations, defects } = await sweep(optionsOf, (o) =>
      BymaxRealtimeModule.forRoot(o as never),
    )
    expect(operations).toBeGreaterThan(20)
    expect(defects).toEqual([])
  })

  // Scenario: the registration of forRootAsync. Expected: the same, for every key the module reads from it.
  it('forRootAsync reads the registration', async () => {
    const { operations, defects } = await sweep(registrationOf, (r) =>
      BymaxRealtimeModule.forRootAsync(r as never),
    )
    expect(operations).toBeGreaterThan(8)
    expect(defects).toEqual([])
  })

  // Scenario: the object a synchronous factory returns, read when the module is compiled. Expected: the same. The
  // authenticator and the hooks stay plain here: the services call into them after validation, and a host function
  // that fails is the host's own failure; their reads during validation are swept by the forRoot case above.
  it('the module reads the object a factory returns', async () => {
    const { operations, defects } = await sweep(
      optionsOf,
      (o) =>
        Test.createTestingModule({
          imports: [
            BymaxRealtimeModule.forRootAsync({ transport: 'sse', useFactory: () => o as never }),
          ],
        }).compile(),
      ['authenticator', 'hooks'],
    )
    expect(operations).toBeGreaterThan(20)
    expect(defects).toEqual([])
  })
})
