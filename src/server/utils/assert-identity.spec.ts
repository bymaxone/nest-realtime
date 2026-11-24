/**
 * @fileoverview Unit tests for tenant resolution and blank-identity rejection.
 * @layer utils
 */
import vm from 'node:vm'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { assertIdentityIsNotBlank, resolveAuthTenant } from './assert-identity'

/** Build an auth result the compiler would reject, as a consumer's JavaScript can. */
function untyped(value: unknown): AuthenticationResult {
  return value as AuthenticationResult
}

const BLANK_USER =
  `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned a userId that is not a ` +
  'non-empty string. A blank identity indexes every such connection under one key and joins ' +
  'them to the same room; return a real userId, or reject the connection by returning null.'

const BLANK_TENANT =
  `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned a tenantId that is present ` +
  'but not a non-empty string. Omit it, or return undefined or null, for a connection that ' +
  'belongs to no tenant — that is indexed under none and joins no tenant room, which an empty ' +
  'string is not.'

describe('assertIdentityIsNotBlank', () => {
  // The ordinary case, and what covers the `!== undefined` guard: a result with no
  // tenantId reads as undefined at runtime, so the tenant branch short-circuits.
  it('accepts a userId with an absent tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1' })).not.toThrow()
  })

  // Both traits present and real is the other ordinary case.
  it('accepts a userId with a real tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: 't1' })).not.toThrow()
  })

  // The whole message is pinned, not its first clause. The remedy is the half a
  // reader acts on, and a message that loses it still reads plausibly while
  // diagnosing nothing.
  it('rejects an empty userId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '' })).toThrow(BLANK_USER)
  })

  // Whitespace is the same defect in a different character: ' ' composes `user: `.
  it('rejects a whitespace-only userId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '   ' })).toThrow(BLANK_USER)
  })

  // A numeric id off a database row satisfies the call site's types and arrives as a
  // non-string. It must be refused by the contract, not by a TypeError naming `trim`,
  // which would report the wrong fault and refuse every connection.
  it('rejects a non-string userId without raising a TypeError', () => {
    expect(() => assertIdentityIsNotBlank(untyped({ userId: 123 }))).toThrow(BLANK_USER)
  })

  // An empty tenantId is a shared bucket rather than an absent tenant.
  it('rejects an empty tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: '' })).toThrow(BLANK_TENANT)
  })

  it('rejects a whitespace-only tenantId', () => {
    // Whitespace is blank: `' '` composes the room `tenant: ` and indexes under `' '`,
    // so it is the empty-string bucket wearing a different character.
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: '\t' })).toThrow(BLANK_TENANT)
  })

  // Reached when a caller skips resolveAuthTenant: that helper normalizes null to
  // absent, so a non-string arriving here is a broken contract rather than no tenant.
  it('rejects a non-string tenantId', () => {
    expect(() => assertIdentityIsNotBlank(untyped({ userId: 'u1', tenantId: 7 }))).toThrow(
      BLANK_TENANT,
    )
  })

  // The userId check runs first: a result blank in both traits names the userId,
  // which is the one with no valid absent form.
  it('names the userId when both traits are blank', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '', tenantId: '' })).toThrow(BLANK_USER)
  })
})

describe('resolveAuthTenant', () => {
  // No resolver configured: the auth result's own tenant is what routes.
  it('falls back to the auth tenantId when no resolver is configured', () => {
    expect(resolveAuthTenant({}, { userId: 'u1', tenantId: 't1' })).toEqual({
      userId: 'u1',
      tenantId: 't1',
    })
  })

  // The resolver wins, which is the whole reason it exists.
  it('prefers the resolver result over the auth tenantId', () => {
    const out = resolveAuthTenant(
      { tenantResolver: () => 't-resolved' },
      { userId: 'u1', tenantId: 't1' },
    )
    expect(out.tenantId).toBe('t-resolved')
  })

  // A resolver returning undefined falls through rather than erasing the tenant.
  it('falls back when the resolver returns undefined', () => {
    const out = resolveAuthTenant(
      { tenantResolver: () => undefined },
      { userId: 'u1', tenantId: 't1' },
    )
    expect(out.tenantId).toBe('t1')
  })

  // The key normalization: null is absent, not a tenant. ConnectionRegistry guards on
  // `!== undefined`, so a null reaching it would index under null and compose the room
  // `tenant:null` — the shared-bucket defect in a value a JWT claim produces routinely.
  it('normalizes a null tenantId to absent', () => {
    const out = resolveAuthTenant({}, untyped({ userId: 'u1', tenantId: null }))
    expect('tenantId' in out).toBe(false)
  })

  // A resolver returning null falls back rather than erasing, because `??` treats it
  // as nullish exactly like undefined. The declared return type is `string | undefined`,
  // where undefined already means "no opinion, keep the auth tenant"; null is off
  // contract and gets the same reading rather than a second, contradictory one.
  it('falls back when the resolver returns null, as it does for undefined', () => {
    const out = resolveAuthTenant({ tenantResolver: () => null }, { userId: 'u1', tenantId: 't1' })
    expect(out.tenantId).toBe('t1')
  })

  // Scenario: tenantId is a getter that counts its reads, with no resolver, a resolver that returns nothing, and a null
  // value. Expected: one read each, and the answer that read gave. Why: a getter can answer differently the second
  // time, so a value that decides the routing room is read once and every later use is of what that read returned.
  it.each([
    ['no resolver', {}, 't1', 't1'],
    ['a resolver that returns undefined', { tenantResolver: () => undefined }, 't1', 't1'],
    ['a null tenantId', {}, null, undefined],
  ])('reads the tenantId of the auth result once with %s', (_name, options, value, expected) => {
    let reads = 0
    const auth = {
      userId: 'u1',
      get tenantId(): string {
        reads += 1
        return value as string
      },
    }

    const out = resolveAuthTenant(options, auth)

    expect(reads).toBe(1)
    expect(out.tenantId).toBe(expected)
  })

  // Scenario: the resolver is configured. Expected: it is given the authenticator's own result, the same object, with
  // everything on it as the authenticator built it. Why: no copy semantics apply to the host's object, so hidden fields,
  // symbol keys, prototype data, accessors and private fields all work as they do for the authenticator's own code.
  it.each([
    ['an absent tenantId', {}],
    ['a present tenantId', { tenantId: 't1' }],
  ])('gives the resolver the result itself, with %s', (_name, extra) => {
    const auth: AuthenticationResult = Object.assign({ userId: 'u1' }, extra)
    let given: unknown

    resolveAuthTenant(
      {
        tenantResolver: (a) => {
          given = a
          return undefined
        },
      },
      auth,
    )

    expect(given).toBe(auth)
  })

  it('lets a resolver derive the tenant from a hidden field, a symbol key and a prototype field', () => {
    const SECRET = Symbol('secret')
    class Result {
      userId = 'u1'
      #tenant = 't-private'
      get trusted(): string {
        return this.#tenant
      }
    }
    Object.defineProperty(Result.prototype, 'scope', { value: 't-scope' })
    const hidden = Object.defineProperty({ userId: 'u1' }, 'trustedTenant', {
      value: 't-hidden',
      enumerable: false,
    })
    const withSymbol = { userId: 'u1', [SECRET]: 't-symbol' }
    const answers: unknown[] = []
    const resolver = (a: object): undefined => {
      answers.push(
        Reflect.get(a, 'trustedTenant') ??
          Reflect.get(a, SECRET) ??
          Reflect.get(a, 'scope') ??
          Reflect.get(a, 'trusted'),
      )
      return undefined
    }

    resolveAuthTenant({ tenantResolver: resolver }, hidden)
    resolveAuthTenant({ tenantResolver: resolver }, withSymbol)
    resolveAuthTenant({ tenantResolver: resolver }, new Result())

    expect(answers).toEqual(['t-hidden', 't-symbol', 't-scope'])
  })

  // Scenario: the resolver writes to the result it was given, at the top level and inside it, with an absent, a null
  // and a present tenant. Expected: the top-level writes change nothing the library keeps; the write inside a nested
  // object is visible in what is kept. Why: the kept record is built, by name, before the resolver runs, so it is a
  // different object from the one the resolver is handed; nested objects are shared, as the README says.
  it.each([
    ['absent', undefined],
    ['null', null],
    ['present', 't1'],
  ])(
    'keeps the record apart from what a resolver writes at the top level, with a tenantId that is %s',
    (_n, tenant) => {
      const auth: { -readonly [K in keyof AuthenticationResult]: AuthenticationResult[K] } = {
        userId: 'u1',
        roles: ['member'],
        metadata: { k: 1 },
      }
      if (tenant !== undefined) Object.assign(auth, { tenantId: tenant })

      const out = resolveAuthTenant(
        {
          tenantResolver: (a) => {
            Object.assign(a, {
              userId: 'mutated',
              roles: ['root'],
              tenantId: 't-mutated',
              extra: 1,
            })
            ;(a.metadata as Record<string, unknown>)['k'] = 2
            return undefined
          },
        },
        auth,
      )

      expect(out.userId).toBe('u1')
      expect(out.roles).toEqual(['member'])
      expect('extra' in out).toBe(false)
      expect(out.tenantId).toBe(tenant ?? undefined)
      expect(out.metadata).toEqual({ k: 2 })
    },
  )

  // Scenario: only some of the fields are on the object itself; the rest come from the prototype, from a class
  // default, from Object.create or from an accessor. Expected: the kept record holds them, read the way JS reads them.
  // Why: the authenticator's own answer is the object as its code reads it, and a field supplied by the prototype is
  // part of that answer, so the record must hold it.
  it.each([
    [
      'a class default and an accessor',
      () => {
        class Result {
          roles = ['admin']
          get userId(): string {
            return 'u-proto'
          }
        }
        return new Result() as AuthenticationResult
      },
    ],
    [
      'Object.create',
      () => Object.create({ userId: 'u-proto', roles: ['admin'] }) as AuthenticationResult,
    ],
  ])(
    'keeps the fields %s supplies, so a userId only on the prototype is admitted',
    (_name, build) => {
      const out = resolveAuthTenant({}, build())

      expect(out.userId).toBe('u-proto')
      expect(out.roles).toEqual(['admin'])
      expect(() => assertIdentityIsNotBlank(out)).not.toThrow()
    },
  )

  it('still refuses a blank userId that the prototype supplies', () => {
    const auth = Object.create({ userId: '  ' }) as AuthenticationResult

    expect(() => assertIdentityIsNotBlank(resolveAuthTenant({}, auth))).toThrow(/userId/)
  })

  // Scenario: the result is a class whose getters read private fields, and a resolver that reads them. Expected: no
  // error. Why: the resolver is given the instance itself, so the receiver of every getter is right.
  it('lets a resolver read a getter over a private field', () => {
    class Result {
      userId = 'u1'
      #roles = ['admin']
      get roles(): string[] {
        return this.#roles
      }
    }
    let seen: unknown

    const out = resolveAuthTenant(
      {
        tenantResolver: (a) => {
          seen = a.roles
          return undefined
        },
      },
      new Result(),
    )

    expect(seen).toEqual(['admin'])
    expect(out.roles).toEqual(['admin'])
  })

  // Scenario: every field the library keeps is read once. Expected: one read each. Why: a getter can answer differently
  // the second time and the record must hold the value that was tested.
  it('reads each field the library keeps once', () => {
    const reads: Record<string, number> = {}
    const counted = <T>(name: string, value: T): T => {
      reads[name] = (reads[name] ?? 0) + 1
      return value
    }
    const auth = {
      get userId(): string {
        return counted('userId', 'u1')
      },
      get tenantId(): string {
        return counted('tenantId', 't1')
      },
      get roles(): string[] {
        return counted('roles', ['r'])
      },
      get rooms(): string[] {
        return counted('rooms', ['x'])
      },
      get metadata(): Record<string, unknown> {
        return counted('metadata', {})
      },
    }

    resolveAuthTenant({}, auth)

    expect(reads).toEqual({ userId: 1, tenantId: 1, roles: 1, rooms: 1, metadata: 1 })
  })

  // Scenario: a result with only a userId, and a result with every field. Expected: the kept record has exactly the
  // fields the result has, none added as an explicit undefined, and each is an ordinary data property. Why: the record
  // is spread, frozen and compared downstream, and `exactOptionalPropertyTypes` treats an undefined key as a different
  // shape from an absent one.
  it('keeps exactly the fields the result has, as ordinary data properties', () => {
    const sparse = resolveAuthTenant({}, { userId: 'u1' })
    const full = resolveAuthTenant(
      {},
      { userId: 'u1', roles: ['r'], rooms: ['x'], metadata: { k: 1 } },
    )

    expect(Reflect.ownKeys(sparse)).toEqual(['userId'])
    expect(Object.keys(full).sort()).toEqual(['metadata', 'roles', 'rooms', 'userId'])
    for (const key of Reflect.ownKeys(full)) {
      expect(Reflect.getOwnPropertyDescriptor(full, key)).toMatchObject({
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  })

  // Scenario: the authenticator's result has a getter that throws. Expected: the library does not wrap it, so the
  // host's own error is what the handshake fails with. Why: the result is the host's own code, the README says so,
  // and the gateway logs the error under `err` and counts the handshake as an error.
  it('raises the error of a getter on the result as it is', () => {
    const auth = {
      userId: 'u1',
      get tenantId(): string {
        throw new Error('the getter threw')
      },
    }

    expect(() => resolveAuthTenant({}, auth)).toThrow(new Error('the getter threw'))
  })

  // An absent tenant stays absent rather than becoming an explicit undefined key,
  // which `exactOptionalPropertyTypes` treats as a different shape.
  it('leaves an absent tenantId absent', () => {
    const out = resolveAuthTenant({}, { userId: 'u1' })
    expect('tenantId' in out).toBe(false)
  })

  // Other traits survive the rewrite: the helper resolves one field, not the object.
  it('preserves roles and metadata', () => {
    const out = resolveAuthTenant(
      {},
      { userId: 'u1', tenantId: 't1', roles: ['admin'], metadata: { traceId: 'x' } },
    )
    expect(out).toEqual({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin'],
      metadata: { traceId: 'x' },
    })
  })

  // A resolver written async returns a promise: the connection is refused as a blank tenant, and the promise's
  // rejection must not be left to the process as an unhandled one.
  it('handles the rejection of a resolver that is async', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const out = resolveAuthTenant(
        { tenantResolver: () => Promise.reject(new Error('late')) as never },
        { userId: 'u1' },
      )
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toHaveBeenCalled()
      expect(typeof out.tenantId).toBe('object')
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  // The residual of absorbing only a native promise: a thenable that is not one is never asked for its `then`
  // (asking could run a lazy query), so its own rejection is not absorbed, and it still cannot route.
  it('does not call the then of a thenable that is not a promise, and still refuses it as a tenant', () => {
    const then = jest.fn()
    const thenable = { then }

    const out = resolveAuthTenant({ tenantResolver: () => thenable as never }, { userId: 'u1' })

    expect(then).not.toHaveBeenCalled()
    expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
  })

  // Scenario: a rejecting promise the native `instanceof` does not recognise, or whose own methods cannot be
  // trusted. Expected: no unhandled rejection reaches the process, and the result still cannot route.
  describe('a rejecting promise of an unusual kind', () => {
    const settle = async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    }

    const rejecting = (): Promise<unknown> => Promise.reject(new Error('late'))

    class OverridesCatch extends Promise<unknown> {
      override catch(): never {
        throw new Error('own catch')
      }
    }

    it.each([
      [
        'from another realm',
        () => vm.runInNewContext("Promise.reject(new Error('late'))") as unknown,
      ],
      ['a subclass that overrides catch', () => OverridesCatch.reject(new Error('late'))],
      [
        'with a then of its own',
        () =>
          Object.defineProperty(rejecting(), 'then', {
            value: () => {
              throw new Error('own then')
            },
          }),
      ],
    ])('is absorbed: %s', async (_name, build) => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const out = resolveAuthTenant({ tenantResolver: () => build() as never }, { userId: 'u1' })
        await settle()

        expect(unhandled).not.toHaveBeenCalled()
        expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    // Scenario: a rejecting promise whose constructor has a species that throws, so that `then` fails before it attaches a
    // handler. Expected: its rejection is handled, no error reaches the process, and the result still cannot route.
    it('is absorbed: a promise whose species throws', async () => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const promise = Object.defineProperty(rejecting(), 'constructor', {
          configurable: true,
          writable: true,
          value: {
            get [Symbol.species](): never {
              throw new Error('own species')
            },
          },
        })
        const out = resolveAuthTenant({ tenantResolver: () => promise as never }, { userId: 'u1' })
        await settle()

        expect(unhandled).not.toHaveBeenCalled()
        expect(Object.getOwnPropertyDescriptor(promise, 'constructor')?.value).toBe(
          (Object.getPrototypeOf((async () => undefined)()) as { constructor: unknown })
            .constructor,
        )
        expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    // Scenario: a proxy whose get trap binds the methods it hands out, over a rejecting promise. The intrinsic
    // `then` refuses it (it is not a promise by brand), so the promise's own `catch` is the way to a handler.
    it('is absorbed: a proxy over a promise, with its methods bound', async () => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const target = rejecting()
        const proxy = new Proxy(target, {
          get: (t, key) => {
            const value = Reflect.get(t, key) as unknown
            return typeof value === 'function' ? (value as () => unknown).bind(t) : value
          },
        })
        const out = resolveAuthTenant({ tenantResolver: () => proxy as never }, { userId: 'u1' })
        await settle()

        expect(unhandled).not.toHaveBeenCalled()
        expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    // Scenario: a proxy over a promise whose own `catch` throws, which is not a promise by brand. Expected: the library does
    // not throw the host's error, and the result still cannot route.
    it('does not throw the host error for a proxy whose catch throws', () => {
      const target = rejecting()
      target.catch(() => undefined)
      const proxy = new Proxy(target, {
        get: (t, key) => {
          if (key === 'catch') {
            throw new Error('own catch')
          }
          return Reflect.get(t, key) as unknown
        },
      })

      const out = resolveAuthTenant({ tenantResolver: () => proxy as never }, { userId: 'u1' })

      expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
    })

    // The residual: a promise whose constructor cannot be read cannot be given a handler, so its own rejection
    // is not absorbed; the library still does not throw the host's error, and the result still cannot route.
    it('does not throw the host error for a promise whose constructor cannot be read', () => {
      const rejected = Promise.reject(new Error('late'))
      rejected.catch(() => undefined)
      const promise = Object.defineProperty(rejected, 'constructor', {
        get: () => {
          throw new Error('own constructor')
        },
      })

      const out = resolveAuthTenant({ tenantResolver: () => promise as never }, { userId: 'u1' })

      expect(() => assertIdentityIsNotBlank(out)).toThrow('REALTIME_AUTH_FAILED')
    })
  })
})

describe('resolveAuthTenant, with get, set or value planted on Object.prototype', () => {
  // Scenario: a data property named like a field of a descriptor is planted on the root prototype, and a result is resolved.
  // Expected: the record is built and no error is raised: the descriptors the library defines with have no prototype, so
  // nothing planted turns one into an accessor or adds a field it did not name.
  it.each(['get', 'set', 'value'])('builds the record with %s planted', (name) => {
    Object.defineProperty(Object.prototype, name, {
      value: 1,
      configurable: true,
      enumerable: true,
      writable: true,
    })
    let resolved: AuthenticationResult | undefined
    let error: unknown
    try {
      resolved = resolveAuthTenant({}, { userId: 'u1', tenantId: 't1', roles: ['admin'] })
    } catch (caught) {
      error = caught
    } finally {
      Reflect.deleteProperty(Object.prototype, name)
    }

    expect(error).toBeUndefined()
    expect([resolved?.userId, resolved?.tenantId, resolved?.roles]).toStrictEqual([
      'u1',
      't1',
      ['admin'],
    ])
  })
})
