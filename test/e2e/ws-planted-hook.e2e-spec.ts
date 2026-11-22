/**
 * @fileoverview End-to-end: a hook planted on `Object.prototype` does not run on a real WebSocket connection.
 * @layer e2e
 *
 * Constraint under test: the hook table is the host's. A function planted under `onConnect` or `onDisconnect` on the
 * root prototype must not run when a client connects and disconnects, while a hook the host defined still does. The
 * tests drive a real Nest application with a real Socket.IO client.
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { IConnectionLifecycleHooks } from '../../src/server/interfaces/connection-lifecycle-hooks.interface'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

/** `names` planted on `Object.prototype` with `value` while `run` runs; they are taken away again when it settles. */
async function planted(
  names: readonly string[],
  value: () => void,
  run: () => Promise<void>,
): Promise<void> {
  const root = Object.prototype as unknown as Record<string, unknown>
  for (const name of names) {
    Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  }
  try {
    await run()
  } finally {
    for (const name of names) delete root[name]
  }
}

/** Each of `values` planted on `Object.prototype` while `run` runs; they are taken away again when it settles. */
async function plantedValues(
  values: Record<string, unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const root = Object.prototype as unknown as Record<string, unknown>
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  }
  try {
    await run()
  } finally {
    for (const name of Object.keys(values)) delete root[name]
  }
}

describe('a planted hook over a real WebSocket connection (e2e)', () => {
  let app: INestApplication | undefined
  let client: ClientSocket | undefined

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    client?.close()
    await app?.close()
    app = undefined
    client = undefined
    jest.restoreAllMocks()
  })

  /** Connects once, stays connected for a moment, then disconnects and waits for the server to notice. */
  async function connectAndLeave(hooks: IConnectionLifecycleHooks | undefined): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          ...(hooks === undefined ? {} : { hooks }),
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const { port } = app.getHttpServer().address() as AddressInfo
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    client = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', reject)
    })
    await sleep(50)
    socket.close()
    await sleep(100)
  }

  // Scenario: onConnect and onDisconnect are planted and the host gave no hooks. Expected: the client still connects,
  // and neither planted function runs.
  it('does not run a planted onConnect or onDisconnect', async () => {
    const calls: string[] = []

    await planted(
      ['onConnect', 'onDisconnect'],
      () => void calls.push('planted'),
      () => connectAndLeave(undefined),
    )

    expect(calls).toStrictEqual([])
  })

  // Scenario: the host defined onConnect and the same name is planted. Expected: the host's runs once, the planted one
  // never.
  it('runs the onConnect the host defined, and not the planted one', async () => {
    const calls: string[] = []

    await planted(
      ['onConnect'],
      () => void calls.push('planted'),
      () => connectAndLeave({ onConnect: () => void calls.push('own') }),
    )

    expect(calls).toStrictEqual(['own'])
  })
})

describe('a planted identity field over a real WebSocket connection (e2e)', () => {
  let app: INestApplication | undefined
  let client: ClientSocket | undefined

  afterEach(async () => {
    client?.close()
    await app?.close()
    app = undefined
    client = undefined
    jest.restoreAllMocks()
  })

  // Scenario: tenantId and roles are planted on the root prototype and the authenticator's result has neither. Expected:
  // the client's `connection:established` carries no tenant and no roles, since the connection belongs to none.
  it('does not give a connection a planted tenantId or roles', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const { port } = app.getHttpServer().address() as AddressInfo
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    client = socket
    const traits = new Promise<{ userId?: string; tenantId?: string; roles?: string[] }>(
      (resolve, reject) => {
        socket.once('connection:established', (event: { traits: object }) => resolve(event.traits))
        socket.once('connect_error', reject)
      },
    )

    let received: { userId?: string; tenantId?: string; roles?: string[] } | undefined
    await plantedValues({ tenantId: 'evil-tenant', roles: ['admin'] }, async () => {
      received = await traits
    })

    expect(received).toStrictEqual({ userId: 'u1' })
  })
})
