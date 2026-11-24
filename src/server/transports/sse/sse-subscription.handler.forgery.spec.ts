/**
 * @fileoverview The handshake's async methods return objects and arrays, and an async function resolves its own promise
 * with such a value by asking it for a `then`: a host that plants one answers for the stream or the gap.
 * @layer transport
 */
import { plantSelfErasingThen, withSelfErasingThen } from '../../../../test/support/forged-promise'
import {
  build,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  mkTransport,
} from '../../../../test/fixtures/sse/subscription-harness'

const FORGED = [{ id: 'injected', type: 'evt', data: {} }]
const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }

describe('SseSubscriptionHandler: what the handshake returns is checked last', () => {
  // Scenario: a reconnect with no Last-Event-ID has no queue to ask, and a `then` that erases itself is planted on
  // Array.prototype after the guard authenticated and before the route runs. Expected: the route refuses; it does not
  // deliver the forged array as the gap.
  it('the route refuses a then planted on arrays when there is no queue to read', async () => {
    const handler = build(mkTransport({ emitConnectionEvent: false }), mkHeartbeat(), mkOptions())
    const req = mkReq()
    const res = mkRes()
    await handler.authenticateBeforeCommit(req, res)
    let stream: unknown
    let failure: unknown

    await withSelfErasingThen(Array.prototype, FORGED, async () => {
      try {
        stream = await handler.handle(req, res)
      } catch (error) {
        failure = error
      }
    })

    expect(stream).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: a `then` that erases itself is planted on Object.prototype while the stream is being built, from the
  // replay read, the last thing the route does before it returns the stream. Expected: the route refuses; the stream it
  // returns is the one it built, or none.
  it('the route refuses a then planted on objects while its stream is built', async () => {
    const getReplayEvents = jest.fn(() => {
      plantSelfErasingThen(Object.prototype, FORGED)
      return []
    })
    const handler = build(
      mkTransport({ emitConnectionEvent: false, getReplayEvents }),
      mkHeartbeat(),
      mkOptions(),
    )
    const req = mkReq({ headers: { 'last-event-id': 'e0' } })
    const res = mkRes()
    await handler.authenticateBeforeCommit(req, res)
    let stream: unknown
    let failure: unknown

    try {
      stream = await handler.handle(req, res)
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Object.prototype, 'then')
    }

    expect(getReplayEvents).toHaveBeenCalledTimes(1)
    expect(stream).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })
})
