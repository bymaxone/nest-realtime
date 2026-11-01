#!/usr/bin/env node
/**
 * Local benchmark for the built package. Not a CI gate: numbers depend on the machine, and the
 * script exists to be rerun and compared on the same one.
 *
 * Usage (after `pnpm build`):
 *   node scripts/benchmark/run.mjs [--only connect,fanout,memory,cross,redis]
 *                                  [--redis-url redis://127.0.0.1:6392] [--out reports/benchmark.json]
 *
 * Each server instance is a separate process (`server.mjs`) so that its memory is its own and the
 * load generator does not share a heap with it. Clients all live in this process, which is a
 * limitation: at high client counts the event loop here can lag, so the loop-delay p99 is reported
 * beside every latency table and a latency that tracks it is a client artefact, not a server one.
 *
 * Latency is receipt time minus the timestamp the server wrote into the payload, both taken from
 * `performance.timeOrigin + performance.now()`, which is comparable between local processes.
 */
import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { dirname } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import { Redis } from 'ioredis'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
const only = new Set((arg('only', 'connect,fanout,memory,cross,redis') ?? '').split(','))
const redisUrl = arg('redis-url', process.env.REDIS_URL)
const outFile = arg('out', 'reports/benchmark.json')

const now = () => performance.timeOrigin + performance.now()
const LOOP_RESOLUTION_MS = 10
const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })

/** Percentile of an unsorted numeric array, nearest-rank. */
function pct(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
const stats = (values) => ({
  n: values.length,
  p50: pct(values, 50),
  p95: pct(values, 95),
  p99: pct(values, 99),
  max: values.length ? Math.max(...values) : null,
})
const round = (x) => (x === null ? null : Math.round(x * 100) / 100)
const fmt = (s) => ({
  ...s,
  p50: round(s.p50),
  p95: round(s.p95),
  p99: round(s.p99),
  max: round(s.max),
})

let nextPort = 3900
const children = new Set()

/** Stop every server this run started: a failed or interrupted run must not leave one listening. */
function killChildren() {
  for (const child of children) child.kill('SIGKILL')
}
process.on('exit', killChildren)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))

/** Start a server process and resolve once it listens. */
async function startServer(transport, { redis = false } = {}) {
  const port = nextPort++
  const child = fork(`${here}/server.mjs`, [], {
    execArgv: ['--expose-gc'],
    env: {
      ...process.env,
      TRANSPORT: transport,
      PORT: String(port),
      ...(redis ? { REDIS_URL: redisUrl } : { REDIS_URL: '' }),
    },
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  const waiting = new Map()
  child.on('message', (msg) => {
    if (msg.cmd === 'ready') waiting.get('ready')?.(msg)
    else waiting.get(msg.id)?.(msg)
  })
  await new Promise((resolve, reject) => {
    waiting.set('ready', resolve)
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)))
  })
  let seq = 0
  const call = (cmd, extra = {}) =>
    new Promise((resolve) => {
      const id = `${cmd}-${seq++}`
      waiting.set(id, resolve)
      child.send({ cmd, id, ...extra })
    })
  return {
    transport,
    port,
    memory: () => call('memory'),
    emit: (count, intervalMs) => call('emit', { count, intervalMs }),
    stop: async () => {
      child.send({ cmd: 'stop' })
      await new Promise((resolve) => child.once('exit', resolve))
    },
  }
}

/**
 * Open one client. Resolves with `{ established, close }` once `connection:established` arrived;
 * `onBench(latencyMs)` is called for every `bench` event the client receives afterwards.
 */
function openClient(server, user, onBench) {
  const started = now()
  if (server.transport === 'websocket') {
    return new Promise((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${server.port}`, {
        transports: ['websocket'],
        query: { u: user },
        reconnection: false,
      })
      socket.on('connect_error', reject)
      socket.on('bench', (data) => onBench?.(now() - data.t, data))
      socket.on('connection:established', () =>
        resolve({ established: now() - started, close: () => socket.close() }),
      )
    })
  }
  return new Promise((resolve, reject) => {
    let ready = false
    const req = get(
      {
        host: '127.0.0.1',
        port: server.port,
        path: `/realtime/sse?u=${encodeURIComponent(user)}`,
        headers: { Accept: 'text/event-stream' },
        agent: false,
      },
      (res) => {
        let buffer = ''
        res.setEncoding('utf8')
        res.on('close', () => {
          if (!ready) reject(new Error('SSE stream closed before connection:established'))
        })
        res.on('data', (chunk) => {
          buffer += chunk
          let end
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const event = /^event: (.*)$/m.exec(frame)?.[1]
            if (event === 'connection:established' && !ready) {
              ready = true
              resolve({ established: now() - started, close: () => req.destroy() })
            } else if (event === 'bench') {
              const data = /^data: (.*)$/m.exec(frame)?.[1]
              if (data) {
                const parsed = JSON.parse(data)
                onBench?.(now() - parsed.t, parsed)
              }
            }
          }
        })
      },
    )
    req.on('error', (err) => {
      if (!ready) reject(err)
    })
  })
}

/** Connect `count` clients in batches, returning them. */
async function connectMany(server, count, onBench, prefix = 'u') {
  const clients = []
  for (let from = 0; from < count; from += 100) {
    const batch = Math.min(100, count - from)
    clients.push(
      ...(await Promise.all(
        Array.from({ length: batch }, (_, i) =>
          openClient(server, `${prefix}${from + i}`, onBench),
        ),
      )),
    )
  }
  return clients
}

// The histogram records the whole timer interval, so the resolution is subtracted to leave the lag.
const loopReport = () => ({
  p50: round(loop.percentile(50) / 1e6 - LOOP_RESOLUTION_MS),
  p99: round(loop.percentile(99) / 1e6 - LOOP_RESOLUTION_MS),
})

async function benchConnect(transport) {
  const server = await startServer(transport)
  const times = []
  for (let i = 0; i < 220; i++) {
    const client = await openClient(server, `c${i}`)
    if (i >= 20) times.push(client.established)
    client.close()
  }
  await server.stop()
  return {
    transport,
    connectMs: fmt(stats(times)),
    note: '200 sequential connects after 20 warm-up',
  }
}

async function benchFanout(transport, clientCount) {
  const server = await startServer(transport)
  const latencies = []
  const slowest = new Map()
  const clients = await connectMany(server, clientCount, (latency, data) => {
    latencies.push(latency)
    slowest.set(data.seq, Math.max(slowest.get(data.seq) ?? 0, latency))
  })
  await sleep(500)
  const emits = 50
  loop.reset()
  await server.emit(emits, 100)
  await sleep(1000)
  const result = {
    transport,
    clients: clientCount,
    emits,
    expectedDeliveries: emits * clientCount,
    received: latencies.length,
    deliveryMs: fmt(stats(latencies)),
    // The slowest recipient of an emit decides when that emit is done for its whole audience.
    slowestRecipientMs: fmt(stats([...slowest.values()])),
    clientLoopDelayMs: loopReport(),
  }
  clients.forEach((c) => c.close())
  await server.stop()
  return result
}

async function benchMemory(transport, clientCount = 1000) {
  const server = await startServer(transport)
  await sleep(1000)
  const idle = await server.memory()
  const clients = await connectMany(server, clientCount)
  await sleep(3000)
  const loaded = await server.memory()
  clients.forEach((c) => c.close())
  await server.stop()
  return {
    transport,
    clients: clientCount,
    rssPerConnectionKiB: round((loaded.rss - idle.rss) / clientCount / 1024),
    heapPerConnectionKiB: round((loaded.heapUsed - idle.heapUsed) / clientCount / 1024),
    idleRssMiB: round(idle.rss / 1024 / 1024),
    loadedRssMiB: round(loaded.rss / 1024 / 1024),
  }
}

async function benchCross(transport, clientCount = 100) {
  const a = await startServer(transport, { redis: true })
  const b = await startServer(transport, { redis: true })
  await sleep(500)
  const latencies = []
  const clients = await connectMany(b, clientCount, (latency) => latencies.push(latency))
  await sleep(500)
  loop.reset()
  await a.emit(50, 100)
  await sleep(1000)
  const result = {
    transport,
    clientsOnOtherInstance: clientCount,
    expectedDeliveries: 50 * clientCount,
    received: latencies.length,
    deliveryMs: fmt(stats(latencies)),
    clientLoopDelayMs: loopReport(),
  }
  clients.forEach((c) => c.close())
  await Promise.all([a.stop(), b.stop()])
  return result
}

async function benchRedisConnections(transport) {
  const probe = new Redis(redisUrl)
  const count = async () => {
    const info = await probe.info('clients')
    return Number(/connected_clients:(\d+)/.exec(info)?.[1]) - 1
  }
  const base = await count()
  const a = await startServer(transport, { redis: true })
  await sleep(500)
  const one = (await count()) - base
  const b = await startServer(transport, { redis: true })
  await sleep(500)
  const two = (await count()) - base
  await Promise.all([a.stop(), b.stop()])
  probe.disconnect()
  return { transport, connectionsAfterOneInstance: one, connectionsAfterTwoInstances: two }
}

const results = { startedAt: new Date().toISOString(), node: process.version, scenarios: {} }
loop.enable()
const transports = ['sse', 'websocket']
const needsRedis = only.has('cross') || only.has('redis')
if (needsRedis && !redisUrl) {
  console.error('cross and redis scenarios need --redis-url (or REDIS_URL); skipping them')
  only.delete('cross')
  only.delete('redis')
}

if (only.has('connect')) {
  results.scenarios.connect = []
  for (const t of transports) results.scenarios.connect.push(await benchConnect(t))
}
if (only.has('fanout')) {
  results.scenarios.fanout = []
  for (const t of transports) {
    for (const n of [1, 100, 1000]) results.scenarios.fanout.push(await benchFanout(t, n))
  }
}
if (only.has('memory')) {
  results.scenarios.memory = []
  for (const t of transports) results.scenarios.memory.push(await benchMemory(t))
}
if (only.has('cross')) {
  results.scenarios.cross = []
  for (const t of transports) results.scenarios.cross.push(await benchCross(t))
}
if (only.has('redis')) {
  results.scenarios.redis = []
  for (const t of transports) results.scenarios.redis.push(await benchRedisConnections(t))
}

/** A cell that received fewer deliveries than it expected is a failed measurement, not a fast one. */
for (const cell of [...(results.scenarios.fanout ?? []), ...(results.scenarios.cross ?? [])]) {
  if (cell.received !== cell.expectedDeliveries) {
    console.error(
      `${cell.transport}: ${cell.received} of ${cell.expectedDeliveries} deliveries arrived`,
    )
    process.exitCode = 1
  }
}

/** Markdown tables for the scenarios that ran, so a results document is generated, not retyped. */
function toMarkdown(report) {
  const out = []
  const row = (cells) => `| ${cells.join(' | ')} |`
  const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')
  const ms = (s) => [s.p50, s.p95, s.p99, s.max]
  const { connect, fanout, memory, cross, redis } = report.scenarios
  if (connect) {
    out.push(
      '### Connect latency (ms)',
      '',
      table(
        ['transport', 'p50', 'p95', 'p99', 'max'],
        connect.map((r) => [r.transport, ...ms(r.connectMs)]),
      ),
      '',
    )
  }
  if (fanout) {
    out.push(
      '### Fan-out latency, emit to client receipt (ms)',
      '',
      table(
        [
          'transport',
          'clients',
          'deliveries',
          'p50',
          'p95',
          'p99',
          'slowest recipient p50',
          'slowest recipient p99',
          'client loop lag p99',
        ],
        fanout.map((r) => [
          r.transport,
          r.clients,
          `${r.received}/${r.expectedDeliveries}`,
          r.deliveryMs.p50,
          r.deliveryMs.p95,
          r.deliveryMs.p99,
          r.slowestRecipientMs.p50,
          r.slowestRecipientMs.p99,
          r.clientLoopDelayMs.p99,
        ]),
      ),
      '',
    )
  }
  if (memory) {
    out.push(
      '### Memory per idle connection',
      '',
      table(
        ['transport', 'clients', 'RSS KiB/conn', 'heap KiB/conn', 'idle RSS MiB', 'loaded RSS MiB'],
        memory.map((r) => [
          r.transport,
          r.clients,
          r.rssPerConnectionKiB,
          r.heapPerConnectionKiB,
          r.idleRssMiB,
          r.loadedRssMiB,
        ]),
      ),
      '',
    )
  }
  if (cross) {
    out.push(
      '### Cross-instance latency through Redis (ms)',
      '',
      table(
        [
          'transport',
          'clients on other instance',
          'deliveries',
          'p50',
          'p95',
          'p99',
          'max',
          'client loop lag p99',
        ],
        cross.map((r) => [
          r.transport,
          r.clientsOnOtherInstance,
          `${r.received}/${r.expectedDeliveries}`,
          ...ms(r.deliveryMs),
          r.clientLoopDelayMs.p99,
        ]),
      ),
      '',
    )
  }
  if (redis) {
    out.push(
      '### Redis connections per instance',
      '',
      table(
        ['transport', 'after 1 instance', 'after 2 instances'],
        redis.map((r) => [
          r.transport,
          r.connectionsAfterOneInstance,
          r.connectionsAfterTwoInstances,
        ]),
      ),
      '',
    )
  }
  return `${out.join('\n')}\n`
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`)
writeFileSync(outFile.replace(/\.json$/, '') + '.md', toMarkdown(results))
console.log(JSON.stringify(results, null, 2))
process.exit(process.exitCode ?? 0)
