/**
 * @fileoverview Executable checks for the consumer patterns the README documents.
 * @layer composition
 *
 * These are not wiring tests for their own sake: each one mirrors a snippet the
 * README tells consumers to write. A snippet that stops compiling or stops running
 * is a broken promise no other gate can see — `pnpm typecheck` covers this file, so
 * a regression in the public option types fails here too. Deleting a test here
 * deletes the guarantee behind the documentation it mirrors.
 */
import { ModuleRef } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from './realtime.module'
import { RealtimeService } from './services/realtime.service'
import type { SseTransport } from './transports/sse/sse.transport'
import {
  REALTIME_HOOKS_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from './constants/injection-tokens.constants'
import type { ConnectionEventMeta, IConnectionLifecycleHooks } from './interfaces'

const authenticator = { authenticate: async () => null }

/** Minimal `ConnectionEventMeta` for firing a lifecycle hook directly. */
function mkMeta(roles: readonly string[] | undefined): ConnectionEventMeta {
  return {
    connectionId: 'c1',
    userId: 'u1',
    tenantId: undefined,
    roles,
    transport: 'sse',
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: new Date(),
  }
}

/**
 * Registers the module exactly as the README's role-scoped rooms section shows.
 *
 * `RealtimeService` is provided BY this module, so it cannot be injected into the
 * factory that configures it; the hook resolves it from `ModuleRef` at connect
 * time instead. The typed `moduleRef` parameter and the abstract `ModuleRef` token
 * are both part of what this exercises — neither compiled before the option types
 * accepted them.
 */
function roleRoomModule() {
  return Test.createTestingModule({
    imports: [
      BymaxRealtimeModule.forRootAsync({
        transport: 'sse',
        inject: [ModuleRef],
        useFactory: (moduleRef: ModuleRef) => ({
          transport: 'sse' as const,
          authenticator,
          hooks: {
            onConnect: async (meta) => {
              if (!meta.roles?.includes('admin')) return
              const realtime = moduleRef.get(RealtimeService)
              await realtime.joinRoom(meta.connectionId, 'role:admin')
            },
          },
        }),
      }),
    ],
  }).compile()
}

describe('README — role-scoped rooms', () => {
  // The documented pattern must actually deliver the join: factory injection of
  // ModuleRef, hook registration, lazy service resolution, delegation to the transport.
  it('joins the role room for a connection carrying the role', async () => {
    const mod = await roleRoomModule()
    await mod.init()
    const joinRoom = jest
      .spyOn(mod.get<SseTransport>(REALTIME_TRANSPORT_TOKEN), 'joinRoom')
      .mockResolvedValue(undefined)

    await mod.get<IConnectionLifecycleHooks>(REALTIME_HOOKS_TOKEN).onConnect?.(mkMeta(['admin']))

    expect(joinRoom).toHaveBeenCalledWith('c1', 'role:admin')
    await mod.close()
  })

  // The negative half, which is the half that matters: a connection without the role
  // must never reach the room. Asserted on the transport call rather than on the meta —
  // a fan-out defect shows up as an extra member, and an assertion about the meta would
  // be a claim about a different object. Absent roles and a non-matching role both count.
  it('does not join the role room for a connection lacking the role', async () => {
    const mod = await roleRoomModule()
    await mod.init()
    const joinRoom = jest
      .spyOn(mod.get<SseTransport>(REALTIME_TRANSPORT_TOKEN), 'joinRoom')
      .mockResolvedValue(undefined)
    const hooks = mod.get<IConnectionLifecycleHooks>(REALTIME_HOOKS_TOKEN)

    await hooks.onConnect?.(mkMeta(['viewer']))
    await hooks.onConnect?.(mkMeta(undefined))

    expect(joinRoom).not.toHaveBeenCalled()
    await mod.close()
  })
})
