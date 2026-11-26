/**
 * @fileoverview Two registrations of one application bound to one namespace, booted with a real server.
 * @layer transport
 *
 * Constraint under test: a namespace is served by one registration. Two of them would each install their authenticator on
 * it, so one socket would be authenticated twice and hold two identities; the boot is refused instead.
 */
import 'reflect-metadata'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Logger, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeWebSocketModule } from '../../realtime-websocket.module'
import { RealtimeIoAdapter } from './realtime-io-adapter'

describe('two registrations bound to one namespace', () => {
  const apps: INestApplication[] = []

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close()
    jest.restoreAllMocks()
  })

  function register(userId: string, namespace?: string): DynamicModule {
    return BymaxRealtimeWebSocketModule.forRoot({
      transport: 'websocket',
      websocket: namespace === undefined ? {} : { namespace },
      authenticator: { authenticate: async () => ({ userId }) },
    })
  }

  /** Boot an application of `imports` behind `RealtimeIoAdapter`. */
  async function boot(imports: DynamicModule['imports']): Promise<void> {
    const moduleRef = await Test.createTestingModule({ imports: imports ?? [] }).compile()
    const app = moduleRef.createNestApplication({ logger: false })
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    apps.push(app)
    await app.listen(0)
  }

  const refusal = (namespace: string): string =>
    `[RealtimeGateway] REALTIME_INVALID_OPTIONS: two registrations in this application bind the WebSocket namespace '${namespace}', so one client would be authenticated by both and hold two identities. Merge them into one forRoot or forRootAsync call, or give each its own websocket.namespace.`

  // Scenario: two `forRoot` calls bind one namespace, written the same way or not, in either import order. Expected: the
  // boot is refused, naming the namespace and nothing else of the options.
  it.each([
    ['the same name', '/a', '/a', '/a'],
    ['no namespace on either', undefined, undefined, '/'],
    ['unset then the root', undefined, '/', '/'],
    ['the root then unset', '/', undefined, '/'],
    ['with and without the slash', 'a', '/a', '/a'],
    ['without and with the slash, swapped', '/a', 'a', '/a'],
  ])('refuses the boot for %s', async (_title, first, second, namespace) => {
    await expect(boot([register('one', first), register('two', second)])).rejects.toThrow(
      refusal(namespace),
    )
  })

  // Scenario: two registrations on two namespaces. Expected: the application boots, as before.
  it('boots with one registration on each of two namespaces', async () => {
    await expect(boot([register('one', '/a'), register('two', '/b')])).resolves.toBeUndefined()
  })

  // Scenario: one registration object imported by two modules, which Nest instantiates once. Expected: it boots.
  it('boots when two modules import the same registration object', async () => {
    const shared = register('one', '/a')
    @Module({ imports: [shared] })
    class First {}
    @Module({ imports: [shared] })
    class Second {}

    await expect(boot([First, Second])).resolves.toBeUndefined()
  })

  // Scenario: two applications of the same namespace in one process, one after the other. Expected: both boot.
  it('boots a second application on the namespace of the first', async () => {
    await boot([register('one', '/a')])

    await expect(boot([register('two', '/a')])).resolves.toBeUndefined()
  })
})
