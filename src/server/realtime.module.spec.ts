/**
 * @fileoverview Integration tests for the dynamic module wiring.
 * @layer composition
 */
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from './realtime.module'
import { RealtimeService } from './services/realtime.service'
import { ConnectionRegistry } from './services/connection-registry.service'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import { REALTIME_HOOKS_TOKEN, REALTIME_PUBSUB_TOKEN } from './constants/injection-tokens.constants'
import type {
  BymaxRealtimeModuleOptions,
  IConnectionLifecycleHooks,
} from './interfaces'
import type { IRealtimePubSub } from './interfaces'

const authenticator = { authenticate: async () => null }

function asOptions(value: unknown): BymaxRealtimeModuleOptions {
  return value as BymaxRealtimeModuleOptions
}

describe('BymaxRealtimeModule.forRoot', () => {
  // The module resolves the public services for an SSE configuration.
  it('wires RealtimeService and ConnectionRegistry for sse', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
    expect(mod.get(ConnectionRegistry)).toBeInstanceOf(ConnectionRegistry)
  })

  // A DynamicModule with exactly one (SSE) controller is produced.
  it('produces a dynamic module with one controller', () => {
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(1)
  })

  // Missing authenticator is rejected at bootstrap.
  it('throws when authenticator is missing', () => {
    expect(() => BymaxRealtimeModule.forRoot(asOptions({ transport: 'sse' }))).toThrow(
      /authenticator is required/,
    )
  })

  // The websocket transport is not available in this release.
  it('throws for the websocket transport', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot({ transport: 'websocket', authenticator }),
    ).toThrow(/not available/)
  })

  // The composite transport is not available in this release.
  it('throws for the both transport', () => {
    expect(() => BymaxRealtimeModule.forRoot({ transport: 'both', authenticator })).toThrow(
      /not available/,
    )
  })

  // Without a pubsub the default in-memory implementation is provided.
  it('defaults to InMemoryPubSub', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBeInstanceOf(InMemoryPubSub)
  })

  // A provided pubsub is used as-is.
  it('uses a provided pubsub', async () => {
    const pubsub: IRealtimePubSub = {
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
    }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, pubsub })],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBe(pubsub)
  })

  // Hooks default to an empty object when none are provided.
  it('defaults hooks to an empty object', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toEqual({})
  })

  // Provided hooks are wired through.
  it('uses provided hooks', async () => {
    const hooks: IConnectionLifecycleHooks = { onConnect: async () => undefined }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, hooks })],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toBe(hooks)
  })
})
