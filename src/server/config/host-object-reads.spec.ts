/**
 * @fileoverview A read of an object the host built that throws is refused with the library's typed error, and `extraProviders` is checked for its shape.
 * @layer composition
 *
 * A getter or a proxy that throws on one key, handed over as the options a factory returns, as the provider
 * `useExisting` names or as the authenticator, is refused with `REALTIME_INVALID_OPTIONS` and the host's own
 * error as the cause; the host's text is never in the message. A registration whose `extraProviders` is not an
 * array of providers is refused the same way.
 */
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../realtime.module'
import { validateOptions } from './validate-options'

const SENTINEL = 'host-text-5c1e9a'
const authenticator = { authenticate: async () => null }

/** An object that answers every key except one, which throws the host's own error. */
const throwingOn = (key: string, target: object): object =>
  new Proxy(target, {
    get: (object, name, receiver) => {
      if (name === key) throw new Error(SENTINEL)
      return Reflect.get(object, name, receiver) as unknown
    },
  })

/** Options with a getter that throws for `hooks`. */
const getterThrows = (): object => ({
  transport: 'sse',
  authenticator,
  get hooks(): never {
    throw new Error(SENTINEL)
  },
})

/** What a refusal must be: the typed code, no host text in the message, the host's error as the cause. */
const typedRefusal = async (attempt: () => unknown, what = 'the options'): Promise<void> => {
  const error = await Promise.resolve()
    .then(attempt)
    .then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
  expect(error).toBeInstanceOf(Error)
  const { message, cause } = error as Error
  expect(message).toBe(
    `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: ${what} could not be read: a getter or a proxy on it throws`,
  )
  expect(message).not.toContain(SENTINEL)
  expect((cause as Error).message).toBe(SENTINEL)
}

describe('options whose read throws', () => {
  // Scenario: the host passes an object, or a proxy over one, that throws on one key. Expected: the typed
  // refusal with the host's error as the cause, not the host's error itself.
  it.each([
    [
      'a proxy that throws on hooks',
      () => throwingOn('hooks', { transport: 'sse', authenticator }),
    ],
    ['a getter that throws', getterThrows],
  ])('is refused as the options of forRoot, %s', async (_name, build) => {
    await typedRefusal(() => BymaxRealtimeModule.forRoot(build() as never))
  })

  it.each([
    [
      'a proxy that throws on hooks',
      () => throwingOn('hooks', { transport: 'sse', authenticator }),
    ],
    ['a getter that throws', getterThrows],
  ])('is refused as the result of a useFactory, %s', async (_name, build) => {
    await typedRefusal(() =>
      Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: () => build() as never,
          }),
        ],
      }).compile(),
    )
  })

  it('is refused as the result of createRealtimeOptions', async () => {
    class Factory {
      createRealtimeOptions(): never {
        return getterThrows() as never
      }
    }
    await typedRefusal(() =>
      Test.createTestingModule({
        imports: [BymaxRealtimeModule.forRootAsync({ transport: 'sse', useClass: Factory })],
      }).compile(),
    )
  })

  // Scenario: the provider useExisting names answers createRealtimeOptions through a getter that throws.
  // Expected: the typed refusal.
  it('is refused as the provider named by useExisting', async () => {
    class Factory {}
    const provider = {
      get createRealtimeOptions(): never {
        throw new Error(SENTINEL)
      },
    }
    await typedRefusal(
      () =>
        Test.createTestingModule({
          imports: [
            BymaxRealtimeModule.forRootAsync({
              transport: 'sse',
              useExisting: Factory,
              extraProviders: [{ provide: Factory, useValue: provider }],
            } as never),
          ],
        }).compile(),
      'the provider named by useExisting or useClass',
    )
  })

  // Scenario: the authenticator is a proxy that throws when its method is read. Expected: the typed refusal.
  it('is refused as the authenticator', async () => {
    await typedRefusal(() =>
      validateOptions({
        transport: 'sse',
        authenticator: throwingOn('authenticate', authenticator),
      } as never),
    )
  })

  // Scenario: a library refusal is raised while the options are read. Expected: it passes through untouched.
  it('keeps the library refusal of an option that is wrong', () => {
    expect(() => validateOptions({ transport: 'ftp', authenticator } as never)).toThrow(
      "options.transport must be one of 'sse' | 'websocket' | 'both'",
    )
  })
})

describe('the extraProviders of forRootAsync', () => {
  const register = (extraProviders: unknown): unknown =>
    BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: () => ({ transport: 'sse', authenticator }),
      extraProviders,
    } as never)

  // Scenario: extraProviders is not an array. Expected: the typed refusal at registration, naming the
  // option and what it received, not a raw TypeError.
  it.each([
    [{ x: 1 }, 'an object'],
    ['providers', 'a string'],
    [7, '7'],
    [true, 'a boolean'],
  ])('refuses %p', (value, received) => {
    expect(() => register(value)).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: extraProviders must be an array of providers, received ${received}`,
      ),
    )
  })

  // Scenario: an entry is not a provider. Expected: the typed refusal names its index and what it is.
  it.each([
    [null, 'null'],
    ['provider', 'a string'],
    [7, '7'],
    [{ useValue: 1 }, 'an object with no provide'],
  ])('refuses the entry %p', (entry, received) => {
    expect(() => register([entry])).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: extraProviders[0] must be a provider (a class or an object with provide), received ${received}`,
      ),
    )
  })

  // Scenario: the shapes Nest accepts. Expected: all are accepted at registration.
  it('accepts a class and an object with provide', () => {
    class Service {}
    expect(() =>
      register([
        Service,
        { provide: 'TOKEN', useValue: 1 },
        { provide: Symbol('S'), useFactory: () => 1 },
      ]),
    ).not.toThrow()
  })

  it.each([undefined, null])('accepts a registration whose extraProviders is %p', (value) => {
    expect(() => register(value)).not.toThrow()
  })
})
