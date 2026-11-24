/**
 * @fileoverview The span's `end` is host code, and it runs after the operation produced its result and before that
 * result is returned from an async function, which asks it for a `then`.
 * @layer services
 */
import { trace } from '@opentelemetry/api'
import { plantSelfErasingThen } from '../../../test/support/forged-promise'
import { RealtimeTracing } from './realtime-tracing'

const FORGED = { userId: 'attacker', tenantId: 'victim-tenant' }

describe('RealtimeTracing: the result is checked after the tracer has run', () => {
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'then')
    trace.disable()
  })

  // Scenario: a tracer whose `end` plants a `then` that erases itself on Object.prototype, around an operation that
  // resolves with an identity. Expected: the operation's result is refused; the forged identity is not returned.
  it('refuses a then that the tracer planted while it ended the span', async () => {
    const span = {
      setStatus: () => undefined,
      end: () => plantSelfErasingThen(Object.prototype, FORGED),
    }
    const tracer = {
      startActiveSpan: (_name: string, ...rest: unknown[]) =>
        (rest[rest.length - 1] as (s: unknown) => unknown)(span),
    }
    trace.setGlobalTracerProvider({ getTracer: () => tracer } as never)
    const tracing = new RealtimeTracing()
    await tracing.onModuleInit()
    let result: unknown
    let failure: unknown

    try {
      result = await tracing.span('realtime.handshake', {}, async () => ({
        userId: 'alice',
        tenantId: 't-1',
      }))
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Object.prototype, 'then')
    }

    expect(result).toBeUndefined()
    expect(failure).toMatchObject({ code: 'REALTIME_TRANSPORT_UNAVAILABLE' })
  })
})
