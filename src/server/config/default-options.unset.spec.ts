/**
 * @fileoverview An option that is set to `undefined` or `null` resolves to its default, never to "no bound".
 * @layer composition
 *
 * `{ ...DEFAULT_SSE, ...options.sse }` lets an own key holding `undefined` overwrite the default, and the
 * bounds read downstream (`max <= 0`, `?? 0`) then mean "switched off". Unset keys are dropped before the
 * defaults are merged and before validation.
 */
import { REALTIME_OPTIONS_TOKEN } from '../constants/injection-tokens.constants'
import { BymaxRealtimeModule } from '../realtime.module'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { applyDefaults, DEFAULT_SSE } from './default-options'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }
const UNSET: ReadonlyArray<readonly [string, undefined | null]> = [
  ['undefined', undefined],
  ['null', null],
]

function optionsWith(group: string, key: string, value: unknown): BymaxRealtimeModuleOptions {
  return { transport: 'sse', authenticator, [group]: { [key]: value } } as never
}

describe.each(Object.keys(DEFAULT_SSE) as Array<keyof typeof DEFAULT_SSE>)('sse.%s', (key) => {
  // Scenario: the option is present and holds undefined or null. Expected: it resolves to the library
  // default, the same as when it is absent, and validation accepts it.
  it.each(UNSET)('resolves %s to its default', (_label, value) => {
    const options = optionsWith('sse', key, value)

    expect(() => validateOptions(options)).not.toThrow()
    expect(applyDefaults(options).sse[key]).toBe(DEFAULT_SSE[key])
  })

  // Scenario: the module is registered with the option unset. Expected: the options the services receive
  // carry the default, so no bound is switched off by an own key that holds nothing.
  it.each(UNSET)('reaches the services as its default when registered with %s', (_label, value) => {
    const registration = BymaxRealtimeModule.forRoot(optionsWith('sse', key, value) as never)
    const provided = registration.providers?.find(
      (provider) => (provider as { provide?: unknown }).provide === REALTIME_OPTIONS_TOKEN,
    ) as { useValue: { sse: Record<string, unknown> } }

    expect(provided.useValue.sse[key]).toBe(DEFAULT_SSE[key])
  })
})

describe('the bounds that mean "off" when they are 0 or missing', () => {
  // Scenario: the four bounds the PM named, set to undefined or null. Expected: the default, never 0 and
  // never a missing value that a comparison reads as no cap.
  it.each([
    'maxConnectionsPerUser',
    'maxQueuedBytes',
    'maxQueuedEvents',
    'stallHeartbeats',
  ] as const)('%s keeps its non-zero default', (key) => {
    for (const [, value] of UNSET) {
      const resolved = applyDefaults(optionsWith('sse', key, value)).sse[key]
      expect(resolved).toBeGreaterThan(0)
      expect(resolved).toBe(DEFAULT_SSE[key])
    }
  })
})

describe('the other groups and the top level', () => {
  // Scenario: an integer option of another group set to null. Expected: it is read as unset, so it is
  // accepted, where it used to be refused as "got null".
  it.each([
    ['websocket', 'maxConnectionsPerUser'],
    ['websocket', 'maxHttpBufferSize'],
    ['reauthenticationPolicy', 'concurrency'],
    ['reauthenticationPolicy', 'cacheTtlMs'],
  ] as const)('%s.%s accepts undefined and null as unset', (group, key) => {
    for (const [, value] of UNSET) {
      expect(() => validateOptions(optionsWith(group, key, value))).not.toThrow()
    }
  })

  it.each([
    'maxConnections',
    'maxPendingHandshakes',
    'hookTimeoutMs',
    'authenticateTimeoutMs',
  ] as const)('top-level %s accepts undefined and null as unset', (key) => {
    for (const [, value] of UNSET) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, [key]: value } as never),
      ).not.toThrow()
    }
  })

  // Scenario: the unset keys are dropped from what the services receive, not merely tolerated.
  it('leaves no own key holding undefined or null in the resolved options', () => {
    const resolved = applyDefaults({
      transport: 'sse',
      authenticator,
      maxConnections: undefined,
      websocket: { maxConnectionsPerUser: null },
      reauthenticationPolicy: { concurrency: undefined },
    } as never)

    expect('maxConnections' in resolved).toBe(false)
    expect(resolved.websocket && 'maxConnectionsPerUser' in resolved.websocket).toBe(false)
    expect(
      resolved.reauthenticationPolicy && 'concurrency' in resolved.reauthenticationPolicy,
    ).toBe(false)
  })
})
