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

  // Scenario: a factory that returns at once, not through a promise, answers a proxy whose get trap throws, or one
  // that was revoked. Expected: the typed refusal. Why: `await` reads `then` on what it is given, which runs the trap
  // inside the library's own provider before the options are read, so the guard has to cover that read.
  it.each([
    [
      'a proxy that throws on every key',
      () =>
        new Proxy(
          {},
          {
            get: () => {
              throw new Error(SENTINEL)
            },
          },
        ),
    ],
    ['a proxy that throws on then', () => throwingOn('then', { transport: 'sse', authenticator })],
  ])('is refused as what a synchronous useFactory returns, %s', async (_name, build) => {
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

  it('is refused as what a synchronous createRealtimeOptions returns', async () => {
    class Factory {
      createRealtimeOptions(): never {
        return throwingOn('then', { transport: 'sse', authenticator }) as never
      }
    }
    await typedRefusal(() =>
      Test.createTestingModule({
        imports: [BymaxRealtimeModule.forRootAsync({ transport: 'sse', useClass: Factory })],
      }).compile(),
    )
  })

  // Scenario: an async factory rejects with its own error. Expected: that error reaches the caller as it is, neither
  // wrapped nor renamed. Why: the read of `then` is guarded, and the factory's own failure is not a read of the object.
  it('leaves the rejection of an async useFactory as the factory failure', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: () => Promise.reject(new Error('the factory failed')),
          }),
        ],
      }).compile(),
    ).rejects.toThrow(new Error('the factory failed'))
  })

  // Scenario: a factory answers a thenable that is not a native promise, as a library's own promise type is. Expected:
  // it is awaited and its options are used, so the guard on the read of `then` does not stop a thenable that works.
  it('awaits a thenable a synchronous useFactory returns', async () => {
    const thenable = {
      then: (resolve: (options: unknown) => void) => resolve({ transport: 'sse', authenticator }),
    }
    await expect(
      Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: () => thenable as never,
          }),
        ],
      }).compile(),
    ).resolves.toBeDefined()
  })

  // Scenario: a revoked proxy as the options, from a factory or as the argument of forRoot. Expected: the typed
  // refusal, not the engine's TypeError. Why: `Array.isArray` throws on a revoked proxy.
  it('refuses a revoked proxy returned by a factory and one passed to forRoot', async () => {
    const revoked = (): object => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    }
    expect(() => BymaxRealtimeModule.forRoot(revoked() as never)).toThrow(
      '[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options must be an object, received an object that could not be read',
    )
    await expect(
      Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: () => revoked() as never,
          }),
        ],
      }).compile(),
    ).rejects.toThrow('REALTIME_INVALID_OPTIONS')
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

describe('a revoked proxy where a function is expected', () => {
  // Scenario: a hook is a revoked proxy. Expected: the typed refusal that names the option and says what it received,
  // not the engine's TypeError. Why: describing the value asks whether it is an array, and that question throws on a
  // revoked proxy; this is the path that does not read the value's type first.
  it('is refused with the typed error', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() =>
      validateOptions({ transport: 'sse', authenticator, hooks: { onConnect: proxy } } as never),
    ).toThrow(
      /REALTIME_INVALID_OPTIONS: options\.hooks\.onConnect must be .*, received a built-in object/,
    )
  })
})

describe('an entry of extraProviders whose reads throw', () => {
  const register = (entry: object): unknown =>
    BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: () => ({ transport: 'sse', authenticator }),
      extraProviders: [entry],
    } as never)

  // Scenario: an entry throws on the check that it has `provide`. Expected: the typed refusal that the registration
  // could not be read, with the host's error as the cause.
  it('is refused with the cause when it throws on a has check', async () => {
    const entry = new Proxy(
      { provide: 'X' },
      {
        has: () => {
          throw new Error(SENTINEL)
        },
      },
    )

    await typedRefusal(() => register(entry), 'the registration')
  })

  // Scenario: an entry throws when its type is read. Expected: the refusal names the entry and says it could not be
  // read, with the host's error as the cause. Why: the entry is the host's own object and the library reads it to
  // check its shape, and a second read of it must not decide the wording.
  it('names the entry and what could not be read when the type of the entry throws', () => {
    const entry = new Proxy(
      {},
      {
        get: () => {
          throw new Error(SENTINEL)
        },
      },
    )

    let caught: Error | undefined
    try {
      register(entry)
    } catch (error) {
      caught = error as Error
    }

    expect(caught?.message).toBe(
      '[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: extraProviders[0] must be a provider (a class or an object with provide), received an object that could not be read',
    )
    expect((caught?.cause as Error).message).toBe(SENTINEL)
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
