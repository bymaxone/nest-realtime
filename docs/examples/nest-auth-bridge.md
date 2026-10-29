# Bridging `@bymax-one/nest-auth` to `@bymax-one/nest-realtime`

`@bymax-one/nest-realtime` is **auth-agnostic**: it never imports a concrete authentication
library.  The only auth surface it owns is the `IConnectionAuthenticator` contract.  This
document shows how to bridge `@nestjs/jwt`'s `JwtService`, configured with the same secret and
algorithm that `@bymax-one/nest-auth` signs with, to that contract so you can reuse the same
JWT validation your REST routes use. `@bymax-one/nest-auth` also exports `AuthTokenVerifierService`
(`verifyAccessToken`) from its root entry, which can replace the manual verification below.

Everything in this document is **consumer-side code** — it lives in your NestJS application,
not inside the `@bymax-one/nest-realtime` package.

---

## The bridge class

```typescript
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'  // peer of the consuming app
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'

@Injectable()
export class NestAuthRealtimeBridge implements IConnectionAuthenticator {
  constructor(private readonly jwt: JwtService) {}

  /**
   * Authenticate an incoming SSE or WebSocket connection.
   *
   * For SSE, reads the access token from the HttpOnly cookie (the authorization
   * header is unconditionally stripped by the transport — see Pattern A).
   * For WebSocket, falls back to the Authorization bearer header.
   */
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const token =
      ctx.cookies['access_token'] ?? this.extractBearer(ctx.headers['authorization'])
    if (!token) return null

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string
        tid?: string
        roles?: string[]
      }>(token)
      return { userId: payload.sub, tenantId: payload.tid, roles: payload.roles }
    } catch {
      // Expired, malformed, wrong-audience, or wrong-algorithm tokens.
      return null
    }
  }

  /**
   * Optionally re-validate during long sessions.
   *
   * Return `true` to keep the connection alive, `false` to disconnect.
   * Here we check a Redis revocation list; remove / replace with your own logic.
   */
  async revalidate(
    _connectionId: string,
    originalAuth: AuthenticationResult,
  ): Promise<boolean> {
    // Example: check a Redis SET used for instant revocation.
    // const revoked = await redis.exists(`auth:revoked:${originalAuth.userId}`)
    // return !revoked
    void originalAuth
    return true
  }

  private extractBearer(header: string | undefined): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined
    return header.slice(7)
  }
}
```

---

## Wiring through `forRootAsync`

`forRootAsync` lets you resolve the authenticator (and other options) from DI, so
`JwtService` can be injected by NestJS before the realtime module initialises.

```typescript
import { Module } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'
import { NestAuthRealtimeBridge } from './nest-auth-realtime.bridge'

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '15m' } }),
    BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      imports: [JwtModule],
      extraProviders: [NestAuthRealtimeBridge],
      inject: [NestAuthRealtimeBridge],
      useFactory: (bridge: NestAuthRealtimeBridge) => ({
        transport: 'sse',
        authenticator: bridge,
        reauthenticationPolicy: {
          intervalSeconds: 300,
          onFailure: 'event',
          cacheTtlMs: 60_000,
        },
      }),
    }),
  ],
})
export class AppModule {}
```

---

## Security notes

### JWT rotation

When you rotate the signing key, all outstanding connections will fail their next
periodic `revalidate()` call and be disconnected.  Issue new tokens using the new key
and let clients reconnect.

### Refresh-token handling

The realtime library never interacts with refresh tokens.  Set up a separate REST or
WebSocket endpoint (`POST /auth/refresh`) guarded by the refresh-token cookie.  On a
successful refresh, the client receives a new short-lived access token and reconnects
the SSE stream.

### Redis blacklist (instant revocation)

For instant revocation (e.g. on logout or privilege change), write the `userId` or
`jti` (JWT ID) to a Redis `SET` and check it in `revalidate()`:

```typescript
async revalidate(_connectionId: string, auth: AuthenticationResult): Promise<boolean> {
  const revoked = await redis.exists(`auth:revoked:${auth.userId}`)
  return revoked === 0
}
```

A revocation takes effect at the next re-authentication cycle, at most
`reauthenticationPolicy.intervalSeconds` after it; the cycle covers SSE and WebSocket
connections alike. `cacheTtlMs` can only lengthen that delay. For an instant disconnect, call
`realtimeService.disconnect(connectionId)` from your logout handler, which needs a connection
id you recorded in `onConnect`.

### `cacheTtlMs` and the re-auth interval

`cacheTtlMs` is the positive-result cache window inside `ReauthenticationService`.  A
hit within the window skips a `revalidate()` call; the connection is kept without
hitting Redis.  It matters only when it is larger than the interval
(`cacheTtlMs` below `intervalSeconds * 1000` never produces a hit); set `intervalSeconds`
below your access-token TTL so expiry is detected within one cycle.
