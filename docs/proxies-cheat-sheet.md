# Proxy Configuration Cheat Sheet — SSE

Server-Sent Events (SSE) requires reverse proxies and CDNs to forward data
incrementally (flush), not buffer it.  This cheat sheet covers the most common
infrastructure layers.

The library defaults to a 30 s keepalive interval (`sse.heartbeatMs = 30_000`).
Configure each proxy so its idle timeout is **greater than** the heartbeat interval
plus a safety margin.

---

## nginx

```nginx
location /events {
    proxy_pass         http://upstream;
    proxy_http_version 1.1;

    # Disable response buffering — required for SSE.
    proxy_buffering    off;
    proxy_cache        off;

    # Set idle timeout above the heartbeat interval + margin.
    # With the default 30 s heartbeat, 90 s gives 3× headroom.
    proxy_read_timeout 90s;

    # Forward headers used by the library (IP, forwarding chain).
    proxy_set_header   Host            $host;
    proxy_set_header   X-Real-IP       $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

Key directives:

| Directive | Value | Why |
|---|---|---|
| `proxy_buffering` | `off` | Prevents nginx from buffering the event stream. |
| `proxy_cache` | `off` | Avoids caching an infinite stream. |
| `proxy_read_timeout` | `> heartbeatMs + margin` | nginx's default is 60 s; the 30 s heartbeat beats this, but explicit config is safer. |

---

## Cloudflare

Cloudflare does **not** buffer SSE by default, but it imposes a **100 s cap on
long-lived HTTP responses** on free and most paid plans.

| Plan | Cap | Action |
|---|---|---|
| Free / Pro / Business | 100 s response timeout | Keep `sse.heartbeatMs` ≤ 90 s (default 30 s is safe). The browser reconnects transparently; ensure `Last-Event-ID` replay is enabled. |
| Enterprise | Configurable / no cap | Contact Cloudflare support to raise or remove the timeout for long-lived connections. |

No special Cloudflare configuration is required for buffering — it is disabled by
default for `text/event-stream` responses.

---

## AWS Application Load Balancer (ALB)

ALB has an idle connection timeout that defaults to **60 s**.

```
# AWS CLI — set idle timeout to 120 s on the load balancer
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn <arn> \
  --attributes Key=idle_timeout.timeout_seconds,Value=120
```

Set the timeout to at least `heartbeatMs / 1000 + margin` seconds.  With the default
30 s heartbeat, 120 s provides a comfortable 4× buffer.

| Setting | Value | Why |
|---|---|---|
| `idle_timeout.timeout_seconds` | `> heartbeatMs / 1000 + margin` | Prevents ALB from terminating connections between keepalive writes. |

### HTTP/2 note

ALB supports HTTP/2 between the client and ALB, but downgrades to HTTP/1.1 toward
the target.  SSE works correctly in both directions.

---

## Vercel / Netlify Edge Functions

Both platforms proxy SSE transparently for short streams.  Long-lived connections may
be subject to function execution limits (e.g. Vercel 5 min / 25 min on Pro).  For
persistent SSE, deploy the backend to a container or VM where you control the process
lifetime.

---

## General tips

- **Never compress SSE.** gzip/Brotli stream compression buffers data, negating
  the incremental delivery SSE depends on.  The library sets
  `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` to signal
  this to proxies, but verify your compressor respects these headers.
- **Monitor `Last-Event-ID` reconnects** (a spike indicates proxy-forced disconnects).
- **Set `proxy_read_timeout` / ALB idle timeout** to at least `2 × heartbeatMs` for
  a safe margin.
