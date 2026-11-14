/**
 * The HTTP server of a Nest application, already listening on the IPv4 loopback address.
 *
 * Layer: test support. supertest 7.3.x starts a server that is not listening, and closes it again
 * once its pending requests settle, so each request sent after the last one settled binds a new
 * listener on a new port. A spec that sends thousands of requests in sequence then spends a
 * loopback port per request, on the listener and on the client, and runs the ephemeral range dry
 * under load (`EADDRNOTAVAIL`). A server that is already listening is left alone by supertest, so
 * one listener serves every request until the application is closed.
 */
import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'

/**
 * Starts `app` listening on a port of its own, once, and returns its HTTP server for supertest.
 * The default host of a port-only `listen` is the loopback address (see `loopback-listen.ts`), and
 * `app.close()` closes the listener.
 *
 * @param app - An initialised application.
 * @returns The server, listening.
 */
export async function listeningServer(app: INestApplication): Promise<Server> {
  const server: Server = app.getHttpServer()
  if (!server.listening) await app.listen(0)
  return server
}
