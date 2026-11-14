/**
 * @fileoverview Where a reconnect's last event id comes from: the `Last-Event-ID` header, or the
 * `lastEventId` query parameter of a client that opened a new `EventSource`, which cannot send the
 * header.
 * @layer transport
 */
import {
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  mkTransport,
  StubDelivery,
} from '../../../../test/fixtures/sse/subscription-harness'
import { SseSubscriptionHandler } from './sse-subscription.handler'

/** The longest id that is believed, from either source. */
const BOUND = 256

/** What a reconnect asked each of the three places that read the id for. */
interface Asked {
  ring: unknown[]
  queue: unknown[]
  appended: unknown[]
}

/** Runs the guard and the route for one reconnect and reports the id each read was given. */
async function reconnect(over: Partial<Record<string, unknown>>): Promise<Asked> {
  const getReplayEvents = jest.fn().mockReturnValue([])
  const retrieve = jest.fn().mockResolvedValue([])
  const retrieveAppended = jest.fn().mockResolvedValue([])
  const transport = mkTransport({ emitConnectionEvent: false, getReplayEvents })
  const handler = new SseSubscriptionHandler(
    transport,
    mkHeartbeat(),
    mkOptions(),
    undefined,
    new StubDelivery({ retrieve, acknowledge: jest.fn(), retrieveAppended }),
  )
  const req = mkReq(over)
  const res = mkRes()

  await handler.authenticateBeforeCommit(req, res)
  await handler.handle(req, res)

  return {
    ring: getReplayEvents.mock.calls.map((call) => call[1]),
    queue: retrieve.mock.calls.map((call) => call[1]),
    appended: retrieveAppended.mock.calls.map((call) => call[1]),
  }
}

/** Every read that takes an id was given `id`, once. */
function allAskedFor(id: string): Asked {
  return { ring: [id], queue: [id], appended: [id] }
}

/** No read that takes an id was made. */
const NONE: Asked = { ring: [], queue: [], appended: [] }

describe('SseSubscriptionHandler: the last event id of a reconnect', () => {
  // Scenario: a client that opened a new EventSource, which cannot send the header, resumes with the
  // query parameter. Expected: the ring, the first queue read and the second read all use it. Why:
  // the three places read the id separately, and one that did not would replay from a different point.
  it('reads the id from the query when there is no header, at all three places', async () => {
    expect(await reconnect({ query: { lastEventId: 'q-7' } })).toEqual(allAskedFor('q-7'))
  })

  // Scenario: both are present. Expected: the header. Why: the browser's own restart sends the
  // header, and it is the id of the stream that dropped.
  it('prefers the header when both are present', async () => {
    const asked = await reconnect({
      headers: { 'last-event-id': 'h-1' },
      query: { lastEventId: 'q-2' },
    })

    expect(asked).toEqual(allAskedFor('h-1'))
  })

  // Scenario: a query value that is not one non-empty string. Expected: ignored, as an array in
  // the header is. Why: Express parses `?lastEventId=a&lastEventId=b` to an array and
  // `?lastEventId[x]=1` to an object, and neither is an id.
  it.each([
    ['an array', ['a', 'b']],
    ['an object', { x: '1' }],
    ['a number', 7],
    ['an empty string', ''],
  ])('ignores a query value that is %s', async (_label, value) => {
    expect(await reconnect({ query: { lastEventId: value } })).toEqual(NONE)
  })

  // Scenario: an id one character past the bound, from each source. Expected: treated as absent.
  // Why: a URL carries the id into access logs and caches, and the header has no bound of its own
  // beyond the server's header limit; the ids this library generates are 20 characters.
  it.each([
    ['header', (id: string) => ({ headers: { 'last-event-id': id } })],
    ['query', (id: string) => ({ query: { lastEventId: id } })],
  ])(
    'ignores a %s id longer than the bound, and believes one of exactly the bound',
    async (_s, place) => {
      expect(await reconnect(place('x'.repeat(BOUND + 1)))).toEqual(NONE)
      expect(await reconnect(place('x'.repeat(BOUND)))).toEqual(allAskedFor('x'.repeat(BOUND)))
    },
  )

  // Scenario: an oversized header with a good query. Expected: the query. Why: an id that is not
  // believed is as if it were absent, so the other source is still read.
  it('falls back to the query when the header is longer than the bound', async () => {
    const asked = await reconnect({
      headers: { 'last-event-id': 'x'.repeat(BOUND + 1) },
      query: { lastEventId: 'q-3' },
    })

    expect(asked).toEqual(allAskedFor('q-3'))
  })
})
