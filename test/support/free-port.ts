/**
 * @fileoverview A port the kernel reports free, for a test that has to name a port before something listens on it.
 * @layer support
 */
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'

/** The port of a listener that was opened on port 0 and closed again. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}
