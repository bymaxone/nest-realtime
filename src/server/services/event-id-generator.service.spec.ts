/**
 * @fileoverview Unit tests for the monotonic event-id generator.
 * @layer infrastructure
 */
import { EventIdGenerator } from './event-id-generator.service'

describe('EventIdGenerator', () => {
  let gen: EventIdGenerator

  beforeEach(() => {
    gen = new EventIdGenerator()
  })

  // The first id of a millisecond starts the counter at a zero-padded 1.
  it('formats the first id as {ms}-000001', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_717_000_000_000)
    expect(gen.next()).toBe('1717000000000-000001')
  })

  // Two calls within the same millisecond increment the counter monotonically.
  it('increments the counter within the same millisecond', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000)
    expect(gen.next()).toBe('1000-000001')
    expect(gen.next()).toBe('1000-000002')
  })

  // A new millisecond resets the counter back to 1.
  it('resets the counter when the millisecond changes', () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_001)
    expect(gen.next()).toBe('1000-000001')
    expect(gen.next()).toBe('1001-000001')
  })

  // Ids are unique and lexicographically ordered across many sequential calls.
  it('produces unique, lexicographically ordered ids', () => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000)
    const ids = Array.from({ length: 1_000 }, () => gen.next())
    expect(new Set(ids).size).toBe(1_000)
    expect([...ids].sort()).toEqual(ids)
  })
})
