/**
 * @fileoverview Closing an application that has an open SSE stream, over a real HTTP server.
 * @layer transport
 */
import { get } from 'node:http'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../../realtime.module'

const CLOSE_WITHIN_MS = 5_000

// Longer than the bound, so a close that hangs fails with its own message and not the test's timeout.
jest.setTimeout(20_000)

interface OpenStream {
  readonly req: ClientRequest
  readonly res: IncomingMessage
  /** Resolves once the server has ended the response or the socket has closed. */
  readonly ended: Promise<void>
}

/** Open the SSE route and resolve once `connection:established` has arrived. */
function openStream(port: number): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: '/realtime/sse',
        headers: { accept: 'text/event-stream' },
        agent: false,
      },
      (res) => {
        let text = ''
        const ended = new Promise<void>((done) => {
          res.on('close', done)
          res.on('end', done)
        })
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          text += chunk
          if (text.includes('connection:established')) resolve({ req, res, ended })
        })
      },
    )
    req.on('error', reject)
  })
}

/** Close the application, or fail with a message if it has not finished in time. */
async function closeWithin(app: INestApplication, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`app.close() did not finish within ${ms} ms`)), ms)
  })
  try {
    await Promise.race([app.close(), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

describe('closing an application with SSE connections', () => {
  let app: INestApplication
  let port: number
  let stream: OpenStream | undefined

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterEach(() => {
    // A stream the test left open must not outlive a failed assertion.
    stream?.req.destroy()
    stream = undefined
    jest.restoreAllMocks()
  })

  // Control: nothing keeps the server open.
  it('closes within the bound when no stream is open', async () => {
    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()
  })

  // Control: the client went away first, so only the server's own teardown is left.
  it('closes within the bound when the stream was closed first', async () => {
    stream = await openStream(port)
    stream.req.destroy()
    await stream.ended

    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()
  })

  // The defect: Nest awaits the HTTP server's close before it runs onApplicationShutdown, and the
  // streams were ended only by that hook, so one open stream kept the close pending for ever.
  it('closes within the bound, and ends the stream, while a stream is open', async () => {
    stream = await openStream(port)

    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()

    await expect(stream.ended).resolves.toBeUndefined()
  })
})
