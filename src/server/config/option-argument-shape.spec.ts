/**
 * @fileoverview The options argument, the `forRootAsync` endpoint and a queue's own arguments are checked for their shape.
 * @layer composition
 *
 * An options argument that is not an object, a `sseEndpoint` that is not a usable route, a group that is a
 * built-in object such as a `Date`, an endpoint with whitespace in it and a `RedisOfflineQueue` built from
 * nothing are each refused with `REALTIME_INVALID_OPTIONS`, naming the option and describing what it
 * received by type.
 */
import { Injectable } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Redis } from 'ioredis'
import { RedisOfflineQueue } from '../offline-queue/redis-offline-queue'
import { BymaxRealtimeModule } from '../realtime.module'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }
const SENTINEL = 'SENTINEL-8d44f1'

/** The message a refused option carries, for the module's own checks. */
const refusal = (
  path: string,
  expected: string,
  received: string,
  who = 'BymaxRealtimeModule',
): Error =>
  new Error(`[${who}] REALTIME_INVALID_OPTIONS: ${path} must be ${expected}, received ${received}`)

/** What a host could hand over where an options object is expected, and how the refusal names each. */
const NOT_OPTIONS: ReadonlyArray<readonly [unknown, string]> = [
  [undefined, 'undefined'],
  [null, 'null'],
  [SENTINEL, 'a string'],
  [7, '7'],
  [true, 'a boolean'],
  [[SENTINEL], 'an array'],
  [Symbol(SENTINEL), 'a symbol'],
  [() => SENTINEL, 'a function'],
  [new Date(0), 'a built-in object'],
]

describe('the options argument of forRoot', () => {
  // Scenario: forRoot is called with something that is not an options object. Expected: the typed refusal
  // names the argument and what it received.
  it.each(NOT_OPTIONS)('refuses %p', (value, received) => {
    expect(() => BymaxRealtimeModule.forRoot(value as never)).toThrow(
      refusal('options', 'an object', received),
    )
  })

  it('refuses the same argument when validateOptions is called on its own', () => {
    expect(() => validateOptions(undefined as never)).toThrow(
      refusal('options', 'an object', 'undefined'),
    )
  })
})

describe('the options argument and the factory result of forRootAsync', () => {
  // Scenario: forRootAsync is called with no registration object. Expected: the same typed refusal.
  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [SENTINEL, 'a string'],
  ])('refuses a registration of %p', (value, received) => {
    expect(() => BymaxRealtimeModule.forRootAsync(value as never)).toThrow(
      refusal('options', 'an object', received),
    )
  })

  // Scenario: a factory answers something that is not an options object. Expected: the typed refusal at
  // bootstrap; nothing and null keep their own message, which names the method that returned nothing.
  it.each([
    [SENTINEL, 'a string'],
    ['', 'a string'],
    [7, '7'],
    [0, '0'],
    [false, 'a boolean'],
    [[SENTINEL], 'an array'],
    [new Date(0), 'a built-in object'],
  ])('refuses a factory that answers %p', async (value, received) => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({ transport: 'sse', useFactory: () => value as never }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(refusal('options', 'an object', received))
  })

  it('keeps the message that names the method for a class factory that answers nothing', async () => {
    @Injectable()
    class Nothing {
      createRealtimeOptions(): never {
        return undefined as never
      }
    }
    const testModule = Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync({ transport: 'sse', useClass: Nothing })],
    })
    await expect(testModule.compile()).rejects.toThrow('createRealtimeOptions returned nothing')
  })
})

describe('a factory pattern of forRootAsync that is null', () => {
  @Injectable()
  class ClassFactory {
    createRealtimeOptions(): { transport: 'sse'; authenticator: typeof authenticator } {
      return { transport: 'sse', authenticator }
    }
  }
  const useFactory = (): { transport: 'sse'; authenticator: typeof authenticator } => ({
    transport: 'sse',
    authenticator,
  })
  const COUNT = 'forRootAsync requires exactly one of useFactory, useClass, or useExisting'

  // Scenario: a pattern set to null beside the one in use. Expected: null reads as unset, like undefined,
  // so the registration names one pattern and resolves it.
  it.each([
    ['useFactory', { useClass: ClassFactory }],
    ['useClass', { useFactory }],
    ['useExisting', { useFactory }],
  ])('reads %s of null as unset beside a pattern in use', async (name, rest) => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({ transport: 'sse', [name]: null, ...rest } as never),
      ],
    })
    await expect(testModule.compile()).resolves.toBeDefined()
  })

  // Scenario: the only pattern is null. Expected: the typed refusal at registration, which counts none.
  it.each(['useFactory', 'useClass', 'useExisting'])(
    'refuses a registration whose only pattern is %s of null',
    (name) => {
      expect(() =>
        BymaxRealtimeModule.forRootAsync({ transport: 'sse', [name]: null } as never),
      ).toThrow(`${COUNT} (received 0)`)
    },
  )
})

describe('the sseEndpoint of forRootAsync', () => {
  const register = (sseEndpoint: unknown): unknown =>
    BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      sseEndpoint,
      useFactory: () => ({ transport: 'sse', authenticator }),
    } as never)

  // Scenario: a registration endpoint that is not a non-blank string. Expected: the same check `sse.endpoint`
  // gets, at registration.
  it.each([
    ['', 'a string'],
    ['   ', 'a string'],
    [5, '5'],
    [true, 'a boolean'],
    [Symbol(SENTINEL), 'a symbol'],
    [() => SENTINEL, 'a function'],
    [{}, 'an object'],
    [[SENTINEL], 'an array'],
    [new Date(0), 'a built-in object'],
    [BigInt(7), 'a bigint'],
  ])('refuses %p', (value, received) => {
    expect(() => register(value)).toThrow(
      refusal('options.sseEndpoint', 'a non-blank string', received),
    )
  })

  it.each(['/realtime/sse', 'events', '/'])('accepts %s', (value) => {
    expect(() => register(value)).not.toThrow()
  })

  // An unset endpoint takes the default, whichever way it is unset.
  it.each([undefined, null])('reads %p as unset', (value) => {
    expect(() => register(value)).not.toThrow()
  })
})

describe('an endpoint with whitespace in it', () => {
  // Scenario: an endpoint no request can reach, because a space is encoded in a URL and the route is not.
  // Expected: refused where it is set, both as `sse.endpoint` and as the registration's `sseEndpoint`.
  it.each([' /x ', '/a b', '/a\tb', '/x\n'])('refuses sse.endpoint %j', (value) => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { endpoint: value } }),
    ).toThrow(refusal('options.sse.endpoint', 'a string without whitespace', 'a string'))
  })

  it.each([' /x ', '/a b'])('refuses sseEndpoint %j', (value) => {
    expect(() =>
      BymaxRealtimeModule.forRootAsync({
        transport: 'sse',
        sseEndpoint: value,
        useFactory: () => ({ transport: 'sse', authenticator }),
      }),
    ).toThrow(refusal('options.sseEndpoint', 'a string without whitespace', 'a string'))
  })
})

describe('a group that is a built-in object', () => {
  // Scenario: a Date, a Map or a RegExp where a group is expected. Expected: refused as not an object; a class
  // instance is still read by its keys.
  it.each(['sse', 'websocket', 'reauthenticationPolicy', 'hooks'])(
    'refuses a Date as %s',
    (name) => {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, [name]: new Date(0) } as never),
      ).toThrow(refusal(`options.${name}`, 'an object', 'a built-in object'))
    },
  )

  it.each([new Map(), new Set(), /x/, Promise.resolve()])('refuses %p as a group', (value) => {
    expect(() => validateOptions({ transport: 'sse', authenticator, sse: value } as never)).toThrow(
      refusal('options.sse', 'an object', 'a built-in object'),
    )
  })

  it('still reads a class instance as a group', () => {
    class Sse {
      readonly heartbeatMs = 10_000
    }
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: new Sse() } as never),
    ).not.toThrow()
  })
})

describe('new RedisOfflineQueue(options)', () => {
  const client = {} as unknown as Redis
  const who = 'RedisOfflineQueue'

  // Scenario: the queue is built from nothing, or from something that is not an options object. Expected:
  // the typed refusal at construction.
  it.each(NOT_OPTIONS.filter(([value]) => !(value instanceof Date)))(
    'refuses options %p',
    (value, received) => {
      expect(() => new RedisOfflineQueue(value as never)).toThrow(
        refusal('options', 'an object', received, who),
      )
    },
  )

  // Scenario: no usable client. Expected: refused by path, naming what was received by type.
  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [SENTINEL, 'a string'],
    [7, '7'],
    [true, 'a boolean'],
    [() => SENTINEL, 'a function'],
  ])('refuses a client of %p', (value, received) => {
    expect(() => new RedisOfflineQueue({ client: value } as never)).toThrow(
      refusal('options.client', 'an object', received, who),
    )
  })

  it('accepts a client that is an object', () => {
    expect(() => new RedisOfflineQueue({ client })).not.toThrow()
  })
})
