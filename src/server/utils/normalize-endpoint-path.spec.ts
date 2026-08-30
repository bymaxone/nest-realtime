/**
 * @fileoverview Unit tests for endpoint path normalization.
 * @layer utils
 */
import { normalizeEndpointPath } from './normalize-endpoint-path'

describe('normalizeEndpointPath', () => {
  // A leading slash is removed — '@Sse()' takes a path relative to the controller.
  it('strips a single leading slash', () => {
    expect(normalizeEndpointPath('/events')).toBe('events')
  })

  // A path without a leading slash is already canonical and passes through untouched.
  it('leaves a path without a leading slash unchanged', () => {
    expect(normalizeEndpointPath('events')).toBe('events')
  })

  // Only the first slash is removed: the rest of the path is not a normalization
  // concern, and collapsing '//events' silently would hide a configuration typo.
  it('strips only the first slash of a doubled prefix', () => {
    expect(normalizeEndpointPath('//events')).toBe('/events')
  })

  // Interior slashes are preserved, so nested endpoints keep their shape.
  it('preserves interior slashes', () => {
    expect(normalizeEndpointPath('/realtime/sse')).toBe('realtime/sse')
  })

  // The empty string has no leading slash and must not be indexed into.
  it('returns the empty string unchanged', () => {
    expect(normalizeEndpointPath('')).toBe('')
  })

  // A bare slash normalizes to the empty path rather than staying '/'.
  it('normalizes a bare slash to the empty path', () => {
    expect(normalizeEndpointPath('/')).toBe('')
  })
})
