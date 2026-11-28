/**
 * @fileoverview End-to-end: a reconnect that cannot send `Last-Event-ID` resumes through the
 * `lastEventId` query parameter, over a real HTTP request.
 * @layer e2e
 *
 * Constraint under test: a new `EventSource` has no last event id and so sends no header, which is
 * what `useRealtimeSse` opens after a refusal or on a manual reconnect. The same id in the query
 * reaches the offline queue as it would from the header, the header wins when both are sent, and an
 * id that is not believed (too long, or not one string) is read as no id at all.
 */
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../../src/server/interfaces/offline-queue-storage.interface'

const ENDPOINT = '/realtime/sse'
const BOUND = 256

/** A queue of three events that records the id each read was given. */
class RecordingQueue implements IOfflineQueueStorage {
  readonly asked: string[] = []
  private readonly events: OfflineQueuedEvent[] = ['e-1', 'e-2', 'e-3'].map((id) => ({
    id,
    event: 'tick',
    data: { id },
    emittedAt: new Date(),
  }))

  async append(): Promise<void> {}

  async retrieveSince(_userId: string, sinceId: string): Promise<OfflineQueuedEvent[]> {
    this.asked.push(sinceId)
    return this.events.filter((event) => event.id > sinceId)
  }

  async acknowledge(): Promise<void> {}
}

describe('SSE reconnect that resumes through the query parameter (e2e)', () => {
  let app: INestApplication | undefined
  let queue: RecordingQueue
  let port: number

  beforeEach(async () => {
    queue = new RecordingQueue()
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          offlineQueue: queue,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /** Opens the stream and returns what the server sent up to the first frame containing `until`. */
  function open(
    query: string,
    until = 'connection:established',
    headers: Record<string, string> = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = get(
        {
          host: '127.0.0.1',
          port,
          path: `${ENDPOINT}${query}`,
          headers: { accept: 'text/event-stream', ...headers },
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            text += chunk
            if (!text.includes(until)) return
            resolve(text)
            req.destroy()
          })
        },
      )
      req.on('error', (error) => {
        if (!req.destroyed) reject(error)
      })
    })
  }

  // Scenario: the id is only in the query. Expected: the events after it are delivered, and the
  // queue was asked for that id. Why: this is what the hook sends after a refusal.
  it('delivers what the query id missed, as the header would', async () => {
    const text = await open('?lastEventId=e-1', 'id: e-3')

    expect(text).toContain('id: e-2')
    expect(text).toContain('id: e-3')
    expect(text).not.toContain('id: e-1\n')
    expect(queue.asked[0]).toBe('e-1')
  })

  // Scenario: header and query disagree. Expected: the header's id. Why: it is the id of the stream
  // the browser itself restarted.
  it('reads the header when both are sent', async () => {
    const text = await open('?lastEventId=e-0', 'id: e-3', { 'last-event-id': 'e-2' })

    expect(text).toContain('id: e-3')
    expect(text).not.toContain('id: e-2\n')
    expect(queue.asked[0]).toBe('e-2')
  })

  // Scenario: an id one past the bound. Expected: the queue is not read and the stream still opens.
  // Why: an id that is not believed is no id.
  it('reads an id longer than the bound as no id', async () => {
    const text = await open(`?lastEventId=${'x'.repeat(BOUND + 1)}`)

    expect(text).toContain('connection:established')
    expect(queue.asked).toEqual([])
  })

  // Scenario: the parameter is repeated, which Express parses to an array. Expected: no id.
  it('reads a repeated parameter as no id', async () => {
    const text = await open('?lastEventId=e-1&lastEventId=e-2')

    expect(text).toContain('connection:established')
    expect(queue.asked).toEqual([])
  })
})
