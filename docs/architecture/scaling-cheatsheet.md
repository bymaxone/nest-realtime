# Horizontal Scaling Cheatsheet

> Reference: spec §11.4 (WebSocket Redis adapter) and §11.5 (sticky sessions).

## Transport → cross-instance fan-out

| Transport | Cross-instance fan-out mechanism |
|---|---|
| `'sse'` only | `IRealtimePubSub` — supply a Redis-backed implementation (e.g. `RedisRealtimePubSub`) |
| `'websocket'` only | `@socket.io/redis-adapter` — pass `pubClient` in `websocket.redisAdapter` |
| `'both'` | Each transport scales independently: SSE via `IRealtimePubSub`, WebSocket via the adapter |

## Configuring the WebSocket Redis adapter

```typescript
import Redis from 'ioredis'
import { RealtimeIoAdapter } from '@bymax-one/nest-realtime'

const redis = new Redis(process.env['REDIS_URL']!)

BymaxRealtimeModule.forRoot({
  transport: 'websocket',
  authenticator,
  websocket: {
    redisAdapter: { pubClient: redis },
  },
})

// In main.ts — register the adapter before app.listen():
app.useWebSocketAdapter(new RealtimeIoAdapter(app))
```

The `RealtimeIoAdapter` calls `pubClient.duplicate()` internally to create the
subscriber client — you only need to pass one Redis connection.

## Sticky sessions — mandatory for polling fallback

> **The Redis adapter synchronizes messages across nodes; it does NOT remove the
> load-balancer's session-affinity requirement.**

Socket.IO defaults to HTTP long-polling before upgrading to WebSocket. During the
polling phase every HTTP request for a single Socket.IO connection must reach the
**same backend instance** (sticky sessions / session affinity). If polling requests
are load-balanced across instances without affinity, the upgrade handshake will fail
intermittently.

**Options:**

- **Disable polling** (`transports: ['websocket']`) — removes the affinity requirement
  entirely; connections go straight to WebSocket. Clients with WebSocket-blocking
  proxies or firewalls will fail to connect.
- **Enable sticky sessions** in your load balancer — use IP hash, cookie-based
  affinity, or a proxy that forwards the `io` cookie. All major balancers support
  this (NGINX `ip_hash`, AWS ALB sticky sessions, Cloudflare per-hostname affinity).

The Redis adapter does NOT solve the sticky-session problem — it fans out messages
across instances after a connection is established, but establishment itself requires
session affinity when polling is in use.
