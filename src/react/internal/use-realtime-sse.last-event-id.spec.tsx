/**
 * Tests for how `useRealtimeSse` resumes a stream with the `lastEventId` query parameter.
 * @layer react
 *
 * The first stream opens with the url as given.
 * After an event with id `ev-7` and a failure, the retry opens `?lastEventId=ev-7`; a manual `reconnect()` does too.
 * The latest event id is used, and an event with no id keeps the earlier one.
 * The parameter is added to urls with a query, a fragment or both, and an existing one is replaced.
 * An id containing a space, `&`, `=` and `#` is encoded (`a+b%26c%3Dd%23e`).
 * A url change forgets the id, and returning to an earlier url does not bring it back.
 */
import { act, renderHook } from '@testing-library/react'
import { emitError, emitMessage, EventSourceMock } from '../../../test/setup/react-setup'
import { useRealtimeSse } from './use-realtime-sse'

describe('useRealtimeSse: resuming after a new EventSource', () => {
  let instances: EventSourceMock[]
  let OriginalEventSource: typeof global.EventSource

  beforeEach(() => {
    jest.useFakeTimers()
    instances = []
    OriginalEventSource = global.EventSource
    const TrackedMock = class extends EventSourceMock {
      constructor(url: string, opts?: EventSourceInit) {
        super(url, opts)
        instances.push(this)
      }
    }
    ;(global as unknown as { EventSource: unknown }).EventSource = TrackedMock
  })

  afterEach(() => {
    ;(global as unknown as { EventSource: unknown }).EventSource = OriginalEventSource
    jest.useRealTimers()
  })

  function lastInstance(): EventSourceMock {
    const inst = instances[instances.length - 1]
    if (!inst) throw new Error('No EventSourceMock instance')
    return inst
  }

  /** The URLs the hook has opened, in order. */
  function opened(): string[] {
    return instances.map((instance) => instance.url)
  }

  /** The stream is open and delivers an event carrying `id`. */
  function receive(id: string): void {
    act(() => {
      const source = lastInstance()
      source.readyState = 1
      source.onopen?.(new Event('open'))
      emitMessage(source, { n: 1 }, id)
    })
  }

  /** The stream fails and the hook's backoff opens the next one. */
  function failAndRetry(): void {
    act(() => emitError(lastInstance()))
    act(() => jest.advanceTimersByTime(2_000))
  }

  // Scenario: the hook opens its first stream. Expected: the url exactly as given. Why: nothing has
  // been received, so there is nothing to resume after, and a server that does not know the
  // parameter must see the request it always saw.
  it('opens the first stream with the url as given', () => {
    renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))

    expect(opened()).toEqual(['/realtime/sse'])
  })

  // Scenario: an event arrives, the stream fails and the backoff opens a new one. Expected: the new
  // stream asks for what follows the last event. Why: a refusal ends a native EventSource, and the
  // hook's own new object cannot send the header, so without this the gap is never replayed.
  it('resumes after the last event id when its backoff opens a new stream', () => {
    renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    receive('ev-7')

    failAndRetry()

    expect(opened()).toEqual(['/realtime/sse', '/realtime/sse?lastEventId=ev-7'])
  })

  it('resumes after the last event id on a manual reconnect', () => {
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    receive('ev-7')

    act(() => result.current.reconnect())

    expect(opened()).toEqual(['/realtime/sse', '/realtime/sse?lastEventId=ev-7'])
  })

  it('asks for what follows the latest event, not the first', () => {
    renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    receive('ev-7')
    act(() => emitMessage(lastInstance(), { n: 2 }, 'ev-9'))

    failAndRetry()

    expect(lastInstance().url).toBe('/realtime/sse?lastEventId=ev-9')
  })

  // Scenario: an event that carries no id after one that did. Expected: the earlier id is kept.
  // Why: a frame without an id says nothing about where the stream stands.
  it('keeps the last id through an event that carries none', () => {
    renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    receive('ev-7')
    act(() => emitMessage(lastInstance(), { n: 2 }))

    failAndRetry()

    expect(lastInstance().url).toBe('/realtime/sse?lastEventId=ev-7')
  })

  it.each([
    ['a url that has a query', '/realtime/sse?room=a', '/realtime/sse?room=a&lastEventId=ev-7'],
    ['a url that has a fragment', '/realtime/sse#top', '/realtime/sse?lastEventId=ev-7#top'],
    [
      'a url that has both',
      '/realtime/sse?room=a#top',
      '/realtime/sse?room=a&lastEventId=ev-7#top',
    ],
  ])('adds the parameter to %s', (_label, url, expected) => {
    renderHook(() => useRealtimeSse({ url }))
    receive('ev-7')

    failAndRetry()

    expect(lastInstance().url).toBe(expected)
  })

  // Scenario: the application gave the first stream a cursor of its own in the url, as the README
  // allows. Expected: the first stream opens as given, and once an event has been seen the id replaces
  // the application's cursor and keeps the other parameters. Why: two `lastEventId` parameters
  // arrive at the server as an array, which it reads as no id, so the gap would be lost.
  it.each([
    ['a cursor of its own', '/realtime/sse?lastEventId=e-1', '/realtime/sse?lastEventId=ev-7'],
    [
      'a cursor between other parameters',
      '/realtime/sse?room=a&lastEventId=e-1&x=2',
      '/realtime/sse?room=a&lastEventId=ev-7&x=2',
    ],
    [
      'a cursor and a fragment',
      '/realtime/sse?lastEventId=e-1#top',
      '/realtime/sse?lastEventId=ev-7#top',
    ],
  ])('replaces %s instead of adding a second parameter', (_label, url, expected) => {
    renderHook(() => useRealtimeSse({ url }))
    expect(opened()).toEqual([url])
    receive('ev-7')

    failAndRetry()

    expect(lastInstance().url).toBe(expected)
  })

  // Scenario: other parameters are in the url. Expected: they come back with the same meaning, but
  // not always the same text, since they are read and written again once there is an id to add. Why:
  // pinned so that a change of what the reconnect url looks like is a decision and not an accident.
  it.each([
    [
      'a key with no value gains an equals sign',
      '/realtime/sse?flag',
      '/realtime/sse?flag=&lastEventId=ev-7',
    ],
    [
      'an encoded plus stays a plus',
      '/realtime/sse?q=a%2Bb',
      '/realtime/sse?q=a%2Bb&lastEventId=ev-7',
    ],
    [
      'an encoded space is written as a plus',
      '/realtime/sse?q=a%20b',
      '/realtime/sse?q=a+b&lastEventId=ev-7',
    ],
    [
      'an empty parameter is dropped',
      '/realtime/sse?a=1&&b=2',
      '/realtime/sse?a=1&b=2&lastEventId=ev-7',
    ],
    [
      'a repeated parameter is kept',
      '/realtime/sse?a=1&a=2',
      '/realtime/sse?a=1&a=2&lastEventId=ev-7',
    ],
  ])('writes the other parameters again: %s', (_label, url, expected) => {
    renderHook(() => useRealtimeSse({ url }))
    receive('ev-7')

    failAndRetry()

    expect(lastInstance().url).toBe(expected)
  })

  // Scenario: a url that begins with its query or its fragment, which resolves against the page. The
  // `?` or `#` is at index 0 there, and a test for "found" that read 0 as "absent" would drop the
  // query or the fragment.
  it.each([
    ['a url that is only a query', '?room=a', '?room=a&lastEventId=ev-7'],
    ['a url that is only a fragment', '#top', '?lastEventId=ev-7#top'],
    ['a url that is a query and a fragment', '?room=a#top', '?room=a&lastEventId=ev-7#top'],
  ])('adds the parameter to %s', (_label, url, expected) => {
    renderHook(() => useRealtimeSse({ url }))
    receive('ev-7')

    failAndRetry()

    expect(lastInstance().url).toBe(expected)
  })

  it('encodes an id that is not a plain token', () => {
    renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    receive('a b&c=d#e')

    failAndRetry()

    expect(lastInstance().url).toBe('/realtime/sse?lastEventId=a+b%26c%3Dd%23e')
  })

  // Scenario: the url changes. Expected: the new stream starts from nothing. Why: another url is
  // another stream, and an id from the first means nothing to it.
  it('forgets the id when the url changes', () => {
    const { rerender } = renderHook(({ url }) => useRealtimeSse({ url }), {
      initialProps: { url: '/realtime/sse' },
    })
    receive('ev-7')

    rerender({ url: '/other/sse' })
    act(() => {
      const source = lastInstance()
      source.readyState = 1
      source.onopen?.(new Event('open'))
    })
    failAndRetry()

    expect(opened()).toEqual(['/realtime/sse', '/other/sse', '/other/sse'])
  })

  // Scenario: the url goes to another stream and back, with no event on the other one. Expected: the
  // stream for the first url opens bare. Why: an id from before the detour may be arbitrarily old,
  // and "forgets" has to hold for a url that was seen earlier too.
  it('does not bring an id back when the url returns to one it had before', () => {
    const { rerender } = renderHook(({ url }) => useRealtimeSse({ url }), {
      initialProps: { url: '/realtime/sse' },
    })
    receive('ev-7')

    rerender({ url: '/other/sse' })
    rerender({ url: '/realtime/sse' })

    expect(opened()).toEqual(['/realtime/sse', '/other/sse', '/realtime/sse'])
  })
})
