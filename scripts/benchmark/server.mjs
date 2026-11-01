#!/usr/bin/env node
/**
 * One benchmark server instance, started and driven by `run.mjs` over IPC.
 *
 * It boots the *built* package (`dist/`) the way a consumer would, so the numbers describe what
 * ships and not the source tree. The authenticator trusts the `u` query parameter: the benchmark
 * measures the transport, not an identity provider.
 *
 * Environment: TRANSPORT=sse|websocket, PORT, REDIS_URL (optional; turns on the Redis fan-out).
 */
import { createRequire } from 'node:module'
import { NestFactory } from '@nestjs/core'
import { Redis } from 'ioredis'
import { performance } from 'node:perf_hooks'
import { BymaxRealtimeModule, RealtimeService, RedisRealtimePubSub } from '@bymax-one/nest-realtime'
import { BymaxRealtimeWebSocketModule, RealtimeIoAdapter } from '@bymax-one/nest-realtime/websocket'

// The ESM bundle loads the optional Redis adapter with a bare `require`, which an ES module does not
// have. BENCH_REQUIRE_SHIM=1 supplies one so the adapter can be measured; unset, the bundle is
// measured exactly as a consumer receives it.
if (process.env.BENCH_REQUIRE_SHIM === '1') globalThis.require = createRequire(import.meta.url)

const transport = process.env.TRANSPORT === 'websocket' ? 'websocket' : 'sse'
const port = Number(process.env.PORT)
const redisUrl = process.env.REDIS_URL

const authenticator = {
  authenticate: async (ctx) => {
    const user = ctx.query.u
    return typeof user === 'string' && user !== '' ? { userId: user } : null
  },
}

/** Epoch milliseconds with sub-millisecond precision, comparable across local processes. */
const now = () => performance.timeOrigin + performance.now()

const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: false }) : undefined
const imports =
  transport === 'sse'
    ? [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator,
          ...(redis ? { pubsub: new RedisRealtimePubSub({ client: redis }) } : {}),
        }),
      ]
    : [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator,
          ...(redis ? { websocket: { redisAdapter: { pubClient: redis } } } : {}),
        }),
      ]

const app = await NestFactory.create(
  { module: class BenchModule {}, imports },
  { logger: ['error'] },
)
if (transport === 'websocket') app.useWebSocketAdapter(new RealtimeIoAdapter(app))
await app.listen(port, '127.0.0.1')
const realtime = app.get(RealtimeService)

process.on('message', async (msg) => {
  if (msg.cmd === 'memory') {
    globalThis.gc?.()
    const { rss, heapUsed, external } = process.memoryUsage()
    process.send({ cmd: 'memory', id: msg.id, rss, heapUsed, external })
  } else if (msg.cmd === 'emit') {
    for (let seq = 0; seq < msg.count; seq++) {
      await realtime.broadcast('bench', { seq, t: now() })
      await new Promise((resolve) => setTimeout(resolve, msg.intervalMs))
    }
    process.send({ cmd: 'emitted', id: msg.id })
  } else if (msg.cmd === 'stop') {
    await app.close()
    redis?.disconnect()
    process.exit(0)
  }
})
process.send({ cmd: 'ready' })
