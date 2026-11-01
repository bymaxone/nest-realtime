# Benchmark results — 2026-10-31

A local measurement of the built package, not a CI gate. Numbers depend on the machine; the script exists to be rerun and compared on the same one.

> [!IMPORTANT]
> **Read the tables with the noise in mind.** Two runs on this machine differ by up to about 2.5 ms in fan-out p50 at 1000 clients (28–48%) and by up to 1.35 ms in single-client p99. A difference smaller than that between two cells, or between two runs, is not a finding. The ordering of the cells and their order of magnitude are stable; see [Run-to-run spread](#run-to-run-spread).

## How to reproduce

```bash
pnpm build
docker run --rm -d --name bench-redis -p 6392:6379 redis:8-alpine
pnpm benchmark --redis-url redis://127.0.0.1:6392 --out reports/benchmark.json
docker stop bench-redis
```

`--only connect,fanout,memory,cross,redis` selects scenarios; without `--redis-url` the two Redis scenarios are skipped. The script writes the JSON and a Markdown file with the tables below next to it.

Each server instance is its own process (`scripts/benchmark/server.mjs`) booting `dist/` the way a consumer would, so memory is the server's own and the load generator shares no heap with it. All clients live in one process (`scripts/benchmark/run.mjs`), over loopback; at high client counts that process can lag, so its event-loop delay is reported beside every latency table. Latency is receipt time minus a timestamp the server writes into the payload, both from `performance.timeOrigin + performance.now()`, which is comparable between local processes. The authenticator trusts a `u` query parameter, so the numbers describe the transport, not an identity provider.

## Machine and versions

|                                        |                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Machine                                | Apple M4 Max, 14 cores, 36 GiB, macOS 27.2                                                                                          |
| Node.js / pnpm                         | v24.21.0 / 11.20.0                                                                                                                  |
| Package                                | built `dist/` of `f8457d8` (1.2.3 candidate) plus the benchmark scripts                                                             |
| socket.io / socket.io-client           | 4.8.4 / 4.8.4                                                                                                                       |
| `@socket.io/redis-adapter` / `ioredis` | 8.3.0 / 6.0.0                                                                                                                       |
| `@nestjs/core`                         | 11.2.8                                                                                                                              |
| Redis                                  | 8.10.3, `redis:8-alpine@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537`, a container on loopback port 6392 |

Load average (1, 5, 15 minutes) before run 1: 11.70, 15.72, 14.88; after run 2: 6.71, 12.26, 13.61. The machine was shared and still settling, so read the absolute latencies as upper-ish bounds. The client event-loop delay p99 was between 2.1 and 2.6 ms in every cell.

## Scenarios

- **Connect:** 200 sequential connections after 20 warm-up ones, from the request to `connection:established`.
- **Fan-out:** 1, 100 and 1000 connected clients on one instance; 50 broadcasts 100 ms apart; per-delivery latency and the latency of the slowest recipient of each emit.
- **Memory:** process RSS and heap after a forced garbage collection, before and after 1000 idle connections, divided by 1000.
- **Cross-instance:** two server processes sharing one Redis; 100 clients on instance B, 50 emits from instance A.
- **Redis connections:** `connected_clients` on the Redis server after one and after two instances started (the probe's own connection excluded).

## Run 1

Same noise caveat as above: compare orders of magnitude, not 2 ms.

#### Connect latency (ms)

| transport | p50  | p95  | p99  | max  |
| --------- | ---- | ---- | ---- | ---- |
| sse       | 0.25 | 0.38 | 0.67 | 1.04 |
| websocket | 0.43 | 0.64 | 1    | 1.21 |

#### Fan-out latency, emit to client receipt (ms)

| transport | clients | deliveries  | p50  | p95   | p99   | slowest recipient p50 | slowest recipient p99 | client loop lag p99 |
| --------- | ------- | ----------- | ---- | ----- | ----- | --------------------- | --------------------- | ------------------- |
| sse       | 1       | 50/50       | 0.23 | 0.39  | 0.66  | 0.23                  | 0.66                  | 2.13                |
| sse       | 100     | 5000/5000   | 0.99 | 3.38  | 5.15  | 1.33                  | 6.8                   | 2.52                |
| sse       | 1000    | 50000/50000 | 6.7  | 12.04 | 13.94 | 9.06                  | 16.68                 | 2.3                 |
| websocket | 1       | 50/50       | 0.09 | 0.31  | 1.17  | 0.09                  | 1.17                  | 2.32                |
| websocket | 100     | 5000/5000   | 0.59 | 2.08  | 3.61  | 0.92                  | 4.87                  | 2.6                 |
| websocket | 1000    | 50000/50000 | 4.87 | 11.86 | 14.02 | 7.21                  | 16.04                 | 2.62                |

#### Memory per idle connection

| transport | clients | RSS KiB/conn | heap KiB/conn | idle RSS MiB | loaded RSS MiB |
| --------- | ------- | ------------ | ------------- | ------------ | -------------- |
| sse       | 1000    | 78.03        | 25.22         | 108.84       | 185.05         |
| websocket | 1000    | 51.28        | 16.18         | 108.53       | 158.61         |

#### Cross-instance latency through Redis (ms)

| transport | clients on other instance | deliveries | p50  | p95  | p99  | max  |
| --------- | ------------------------- | ---------- | ---- | ---- | ---- | ---- |
| sse       | 100                       | 5000/5000  | 2.45 | 4.94 | 6.27 | 7.26 |
| websocket | 100                       | 5000/5000  | 1.58 | 4.45 | 6.69 | 7.86 |

#### Redis connections per instance

| transport | after 1 instance | after 2 instances |
| --------- | ---------------- | ----------------- |
| sse       | 2                | 4                 |
| websocket | 2                | 4                 |

## Run 2

#### Connect latency (ms)

| transport | p50  | p95  | p99  | max  |
| --------- | ---- | ---- | ---- | ---- |
| sse       | 0.24 | 0.36 | 0.58 | 0.87 |
| websocket | 0.43 | 0.69 | 0.8  | 1.17 |

#### Fan-out latency, emit to client receipt (ms)

| transport | clients | deliveries  | p50  | p95   | p99   | slowest recipient p50 | slowest recipient p99 | client loop lag p99 |
| --------- | ------- | ----------- | ---- | ----- | ----- | --------------------- | --------------------- | ------------------- |
| sse       | 1       | 50/50       | 0.33 | 0.75  | 2.01  | 0.33                  | 2.01                  | 2.23                |
| sse       | 100     | 5000/5000   | 1.98 | 4.86  | 5.41  | 3.42                  | 5.92                  | 2.23                |
| sse       | 1000    | 50000/50000 | 8.58 | 13.39 | 15.16 | 11.91                 | 16.39                 | 2.61                |
| websocket | 1       | 50/50       | 0.14 | 0.33  | 0.36  | 0.14                  | 0.36                  | 2.1                 |
| websocket | 100     | 5000/5000   | 0.6  | 2.86  | 3.71  | 0.93                  | 4.16                  | 2.38                |
| websocket | 1000    | 50000/50000 | 7.22 | 12.24 | 13.49 | 11.09                 | 15.31                 | 2.47                |

#### Memory per idle connection

| transport | clients | RSS KiB/conn | heap KiB/conn | idle RSS MiB | loaded RSS MiB |
| --------- | ------- | ------------ | ------------- | ------------ | -------------- |
| sse       | 1000    | 78.93        | 25.22         | 107.58       | 184.66         |
| websocket | 1000    | 51.68        | 16.18         | 108.06       | 158.53         |

#### Cross-instance latency through Redis (ms)

| transport | clients on other instance | deliveries | p50  | p95  | p99  | max  |
| --------- | ------------------------- | ---------- | ---- | ---- | ---- | ---- |
| sse       | 100                       | 5000/5000  | 1.82 | 4.33 | 6.21 | 7.38 |
| websocket | 100                       | 5000/5000  | 2.54 | 5    | 6.94 | 7.28 |

#### Redis connections per instance

| transport | after 1 instance | after 2 instances |
| --------- | ---------------- | ----------------- |
| sse       | 2                | 4                 |
| websocket | 2                | 4                 |

## Run-to-run spread

- Heap per idle connection is deterministic: identical in both runs (25.22 KiB for SSE, 16.18 KiB for WebSocket). RSS per connection moved by at most 0.9 KiB (1.2%).
- Connect p50 moved by at most 0.01 ms; the p99 tails by at most 0.2 ms.
- Fan-out p50 at 1000 clients moved by 1.9 ms (SSE) and 2.4 ms (WebSocket) between runs, 28–48%; p99 moved by at most 1.2 ms. Single-client p99 moved by up to 1.35 ms (50 samples).
- Treat differences under about 2.5 ms at 1000 clients as noise on this machine. The ordering of the cells and their order of magnitude are stable.

## Findings

1. **The WebSocket Redis adapter did not install in the ES module build.** The first run of the cross-instance scenario delivered 0 of 5000 messages to the other instance and each instance opened one Redis connection instead of two; the instance log said `Dynamic require of "@socket.io/redis-adapter" is not supported`. Fixed in 1.2.3 (#167, #169); the rerun above delivers 5000 of 5000 on both transports.
2. **Fan-out latency grows linearly with the local audience**, at about 7 µs per extra local socket: p50 of 0.1–0.3 ms for one client, 0.6–2 ms for 100, 5–9 ms for 1000. An emit to 1000 clients is complete for its slowest recipient in 7–12 ms.
3. **SSE costs about 50% more memory per idle connection than WebSocket** (about 78 versus 52 KiB of RSS; 25.2 versus 16.2 KiB of heap); the ordering held in both runs.
4. **Cross-instance delivery is in the same range as same-instance delivery at 100 clients** (p50 1.6–2.5 ms against 0.6–2.0 ms), within the noise, and lost nothing.
5. **Two Redis connections per instance on both transports**: the consumer's own client plus the one the library duplicates for the subscriber. The library opens exactly one connection of its own.

## Limits of this measurement

One machine, loopback, no TLS, no proxy; one process generates all the clients; payloads are tiny (a sequence number and a timestamp); the authenticator does no I/O. Fan-out was measured to a single audience (a broadcast), not to rooms or users. Numbers from a different machine are not comparable with these.
