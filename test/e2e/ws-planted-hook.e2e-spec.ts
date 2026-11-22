/**
 * @fileoverview End-to-end: a key planted on `Object.prototype` is not read on a real WebSocket connection, which is refused.
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

  /** Connects once and, when it connects, stays a moment, disconnects and waits for the server to notice. */
  async function connectAndLeave(
    hooks: IConnectionLifecycleHooks | undefined,
    values: Record<string, unknown> = {},
  ): Promise<'connected' | 'refused'> {
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
    let outcome: 'connected' | 'refused' = 'refused'
    // The server booted clean; the values are planted from the moment the client connects until the server has noticed.
    await plantedValues(values, async () => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      })
      client = socket
      outcome = await new Promise<'connected' | 'refused'>((resolve) => {
        socket.once('connect', () => resolve('connected'))
        socket.once('connect_error', () => resolve('refused'))
      })
      await sleep(50)
      socket.close()
      await sleep(100)
    })
    return outcome
  }

  // Scenario: onConnect and onDisconnect are planted while the client connects, and the host gave no hooks. Expected: the
  // WebSocket server refuses the connection, and neither planted function runs.
  it('refuses a connection while onConnect and onDisconnect are planted, and runs neither', async () => {
    const calls: string[] = []
    const planted = () => void calls.push('planted')

    const outcome = await connectAndLeave(undefined, { onConnect: planted, onDisconnect: planted })

    expect(outcome).toBe('refused')
    expect(calls).toStrictEqual([])
  })

  // Scenario: the host defined onConnect, with nothing planted. Expected: the client connects and the host's hook runs
  // once.
  it('runs the onConnect the host defined', async () => {
    const calls: string[] = []

    const outcome = await connectAndLeave({ onConnect: () => void calls.push('own') })

    expect(outcome).toBe('connected')
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

  /** Boots a server that authenticates `u1` and connects once, with `values` planted from the moment the client connects. */
  async function traitsOfConnection(
    values: Record<string, unknown> = {},
  ): Promise<{ userId?: string; tenantId?: string; roles?: string[] } | 'refused'> {
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
    let outcome: Awaited<ReturnType<typeof traitsOfConnection>> = 'refused'
    await plantedValues(values, async () => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      })
      client = socket
      outcome = await new Promise((resolve) => {
        socket.once('connection:established', (event: { traits: object }) => resolve(event.traits))
        socket.once('connect_error', () => resolve('refused'))
      })
    })
    return outcome
  }

  // Scenario: a connection with nothing planted. Expected: the traits carry the user the authenticator returned, and no
  // tenant or roles, since it returned none.
  it('gives a connection the traits the authenticator returned', async () => {
    expect(await traitsOfConnection()).toStrictEqual({ userId: 'u1' })
  })

  // Scenario: tenantId and roles are planted on the root prototype while the client connects. Expected: the connection is
  // refused, so nothing of the planted identity reaches it.
  it('refuses a connection while tenantId and roles are planted', async () => {
    const outcome = await traitsOfConnection({ tenantId: 'evil-tenant', roles: ['admin'] })

    expect(outcome).toBe('refused')
  })
})
