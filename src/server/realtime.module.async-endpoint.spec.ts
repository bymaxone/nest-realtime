/**
 * @fileoverview Integration tests for the SSE route the async path binds.
 * @layer composition
 */
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from './realtime.module'
import { REALTIME_OPTIONS_TOKEN } from './constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions, SseRealtimeModuleAsyncOptions } from './interfaces'

const authenticator = { authenticate: async () => null }

describe('BymaxRealtimeModule.forRootAsync SSE endpoint', () => {
  /** Read the route path the generated SSE controller was decorated with. */
  function routePath(dynamic: { controllers?: unknown[] }): string {
    const ctrl = dynamic.controllers?.[0] as { prototype: Record<string, unknown> }
    return Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object) as string
  }

  /** Resolve the options object the module publishes on REALTIME_OPTIONS_TOKEN. */
  async function resolvedOptions(
    asyncOptions: SseRealtimeModuleAsyncOptions,
  ): Promise<BymaxRealtimeModuleOptions> {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(asyncOptions)],
    }).compile()
    return mod.get<BymaxRealtimeModuleOptions>(REALTIME_OPTIONS_TOKEN)
  }

  // The historical default: a registration that names no endpoint keeps serving
  // '/events', so upgrading never moves the route of a deployed application.
  it('binds the controller to /events when no sseEndpoint is declared', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse' as const, authenticator }),
    })
    expect(routePath(dynamic)).toBe('events')
  })

  // The whole point of the option: the route follows what the registration declares.
  it('binds the controller to a declared sseEndpoint', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      sseEndpoint: '/realtime/sse',
      useFactory: async () => ({ transport: 'sse' as const, authenticator }),
    })
    expect(routePath(dynamic)).toBe('realtime/sse')
  })

  // The published options must name the route that actually exists, or anything
  // reading the config back (a health check, an OpenAPI document) is misled.
  it('reports the bound endpoint on REALTIME_OPTIONS_TOKEN', async () => {
    const options = await resolvedOptions({
      transport: 'sse',
      sseEndpoint: '/realtime/sse',
      useFactory: async () => ({ transport: 'sse' as const, authenticator }),
    })
    expect(options.sse?.endpoint).toBe('/realtime/sse')
  })

  // Without the override the published endpoint would be the forRoot default
  // ('/realtime/sse') while the route is '/events' — the original defect.
  it('reports /events rather than the forRoot default when nothing is declared', async () => {
    const options = await resolvedOptions({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse' as const, authenticator }),
    })
    expect(options.sse?.endpoint).toBe('/events')
  })

  // An endpoint from the factory cannot move a route that was decided earlier, so
  // it is rejected rather than silently ignored.
  it('rejects an sse.endpoint from the factory that disagrees with the bound route', async () => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({
            transport: 'sse' as const,
            authenticator,
            sse: { endpoint: '/realtime/sse' },
          }),
        }),
      ],
    })
    // The whole message is pinned, not a fragment: it is the only place a consumer
    // learns that the fix is 'sseEndpoint' on the registration, and a message that
    // loses that half diagnoses nothing.
    await expect(testModule.compile()).rejects.toThrow(
      '[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: the factory resolved sse.endpoint ' +
        "'/realtime/sse' but forRootAsync bound the SSE route to '/events' — controllers are " +
        "registered before the factory runs, so declare the path as 'sseEndpoint' on the " +
        'forRootAsync registration itself',
    )
  })

  // The comparison is on the normalized path: '@Sse()' resolves 'events' and
  // '/events' to the same route, so they must not be treated as a disagreement.
  it('accepts a factory endpoint that matches the bound route without its leading slash', async () => {
    const options = await resolvedOptions({
      transport: 'sse',
      useFactory: async () => ({
        transport: 'sse' as const,
        authenticator,
        sse: { endpoint: 'events' },
      }),
    })
    expect(options.sse?.endpoint).toBe('/events')
  })

  // A factory that names the same endpoint as the registration is redundant, not wrong.
  it('accepts a factory endpoint equal to the declared sseEndpoint', async () => {
    const options = await resolvedOptions({
      transport: 'sse',
      sseEndpoint: '/stream',
      useFactory: async () => ({
        transport: 'sse' as const,
        authenticator,
        sse: { endpoint: '/stream' },
      }),
    })
    expect(options.sse?.endpoint).toBe('/stream')
  })

  // The rest of the sse block must survive the endpoint being rewritten.
  it('preserves the other sse options while binding the endpoint', async () => {
    const options = await resolvedOptions({
      transport: 'sse',
      sseEndpoint: '/stream',
      useFactory: async () => ({
        transport: 'sse' as const,
        authenticator,
        sse: { heartbeatMs: 1234 },
      }),
    })
    expect(options.sse?.heartbeatMs).toBe(1234)
    expect(options.sse?.endpoint).toBe('/stream')
  })
})
