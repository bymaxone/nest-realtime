/**
 * @fileoverview A scriptable in-process RESP server for exercising a real ioredis client without
 * Redis: it answers each command from a handler, can push pub/sub messages, drop every
 * connection, and stop and start again on the same port.
 * @layer test
 */
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'

/** What the server writes back for one command: a raw RESP reply, or `null` to say nothing. */
export type RespReply = string | null

/** Decides the reply for a command (upper-cased words, e.g. `['SUBSCRIBE', 'ch']`). */
export type RespHandler = (command: readonly string[], socket: Socket) => RespReply

const OK = '+OK\r\n'
const HELLO = '%1\r\n+server\r\n+redis\r\n'

/** The reply a Redis gives to `SUBSCRIBE <channel>`. */
export function subscribed(channel: string): string {
  return `*3\r\n$9\r\nsubscribe\r\n$${channel.length}\r\n${channel}\r\n:1\r\n`
}

/** A pub/sub `message` push on `channel`, as a RESP3 push (ioredis negotiates RESP3 with HELLO). */
export function pushed(channel: string, payload: string): string {
  return `>3\r\n$7\r\nmessage\r\n$${channel.length}\r\n${channel}\r\n$${payload.length}\r\n${payload}\r\n`
}

/** Splits one TCP chunk into the commands it carries, upper-casing every word. */
function commandsIn(chunk: Buffer | string): string[][] {
  return chunk
    .toString()
    .split(/\*\d+\r\n/)
    .filter((part) => part.length > 0)
    .map((part) =>
      part
        .split('\r\n')
        .filter((_word, index) => index % 2 === 1)
        .map((word) => word.toUpperCase()),
    )
}

/** The default behaviour of a healthy Redis for the commands a subscriber connection sends. */
export const healthyRedis: RespHandler = (command) => {
  if (command[0] === 'SUBSCRIBE') return subscribed(command[1] ?? '')
  if (command[0] === 'HELLO') return HELLO
  return OK
}

/** A listening fake server that can be stopped and started again on the same port. */
export class FakeRespServer {
  readonly sockets = new Set<Socket>()
  /** Connections that sent SUBSCRIBE; a push on any other connection would corrupt its replies. */
  private readonly subscribers = new Set<Socket>()
  /** Commands seen, in order, across every connection. */
  readonly seen: string[][] = []
  private server: Server | null = null
  private bound = 0

  constructor(private handler: RespHandler = healthyRedis) {}

  /** The port the server listens on; fixed after the first `start`. */
  get port(): number {
    return this.bound
  }

  /** Replace the behaviour from now on. */
  respond(handler: RespHandler): void {
    this.handler = handler
  }

  /** Listen on the bound port, or on a free one the first time. */
  async start(): Promise<void> {
    const server = createServer((socket) => {
      this.sockets.add(socket)
      socket.on('close', () => {
        this.sockets.delete(socket)
        this.subscribers.delete(socket)
      })
      socket.on('error', () => undefined)
      socket.on('data', (chunk) => {
        for (const command of commandsIn(chunk)) {
          this.seen.push(command)
          if (command[0] === 'SUBSCRIBE') this.subscribers.add(socket)
          const reply = this.handler(command, socket)
          if (reply !== null) socket.write(reply)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(this.bound, '127.0.0.1', resolve))
    this.server = server
    this.bound = (server.address() as { port: number }).port
  }

  /** Destroy every open connection and stop listening, so the port refuses connections. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Destroy every open connection but keep listening, so a client reconnects at once. */
  drop(): void {
    for (const socket of this.sockets) socket.destroy()
  }

  /** Write a raw push to every connection that subscribed. */
  broadcast(reply: string): void {
    for (const socket of this.subscribers) socket.write(reply)
  }
}
