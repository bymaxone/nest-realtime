/**
 * @fileoverview The name a configured `websocket.namespace` stands for.
 * @layer infrastructure
 *
 * Constraint under test: unset and empty are the root, and a name is read with or without its leading slash.
 */
import { socketNamespace } from './socket-namespace'

describe('socketNamespace', () => {
  // Scenario: each way of writing a namespace. Expected: the name Socket.IO gives it.
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['rt', '/rt'],
    ['/rt', '/rt'],
  ])('reads %p as %p', (configured, name) => {
    expect(socketNamespace(configured)).toBe(name)
  })
})
