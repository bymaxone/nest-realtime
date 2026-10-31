/**
 * @fileoverview The names a README snippet uses without declaring them, typed
 * against the published package. `check-published-surface.mjs` copies this file into
 * the throwaway consumer it compiles the snippets in, so a call made through one of
 * these names is checked against the real types instead of resolving to `any`.
 * Only names the surrounding prose introduces belong here; a wrong option, method or
 * field on a package type is a real error and must stay one.
 */
import type { ModuleRef as NestModuleRef } from '@nestjs/core'
import type {
  AuthenticationResult,
  ConnectionEventMeta,
  IConnectionAuthenticator,
  RealtimeService,
} from '@bymax-one/nest-realtime'
import type { ReactElement } from 'react'

declare global {
  /** What `this` holds in a snippet that shows service calls without a class around them. */
  interface SnippetContext {
    realtime: RealtimeService
  }

  const userId: string
  const tenantId: string
  const invoiceId: string
  const entry: Record<string, unknown>

  /** The authenticator the Quick Start section implements. */
  class CookieAuthenticator implements IConnectionAuthenticator {
    authenticate: IConnectionAuthenticator['authenticate']
  }
  /** A one-time ticket store; `consume` is the atomic read-and-delete the prose requires. */
  interface TicketStore {
    consume(ticket: string): Promise<AuthenticationResult | null>
  }
  /** Verifies the access-token cookie and returns its claims, or `null`. */
  function verify(token: string | undefined): Promise<{ sub: string } | null>
  const tracer: { recordConnection(connectionId: string, traceparent: unknown): void }

  /** Defined by an earlier README snippet. */
  function joinRoleRoom(
    resolver: {
      get(token: typeof RealtimeService): { joinRoom(c: string, r: string): Promise<void> }
    },
    role: string,
    roomId: string,
  ): (meta: ConnectionEventMeta) => Promise<void>

  /** The consuming application's own component. */
  function InvoiceList(): ReactElement
  /** `@nestjs/core`, which a fragment names without importing it. */
  type ModuleRef = NestModuleRef
  const ModuleRef: typeof NestModuleRef
}

export {}
