/**
 * @fileoverview What `SseTransport.admit` hands out: a place from the instance's admission, or none
 * when the transport was built without one.
 * @layer transport
 */
import { build } from '../../../../test/fixtures/sse/transport-harness'
import {
  ConnectionAdmission,
  ConnectionLimitError,
} from '../../services/connection-admission.service'
import { ConnectionRegistry } from '../../services/connection-registry.service'

describe('SseTransport.admit', () => {
  it('takes a place from the admission it was given', () => {
    const admission = new ConnectionAdmission(
      { transport: 'sse', authenticator: { authenticate: async () => null }, maxConnections: 1 },
      new ConnectionRegistry(),
    )
    const { transport } = build({ admission })
    const ticket = transport.admit()

    expect(() => transport.admit()).toThrow(ConnectionLimitError)
    ticket.release()
    expect(() => transport.admit()).not.toThrow()
  })

  it('holds nothing, and bounds nothing, when it was built without an admission', () => {
    const { transport } = build()

    for (let i = 0; i < 5; i += 1) {
      const ticket = transport.admit()
      ticket.renew()
      ticket.release()
    }
    expect(() => transport.admit()).not.toThrow()
  })
})
