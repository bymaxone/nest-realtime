/**
 * @fileoverview Every warn and error line is an event with a stable code, listed once, and none carries an identity.
 * @layer utils
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { Subject } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'
import { build } from '../../../test/fixtures/sse/transport-harness'
import { logEvent, REALTIME_LOG_EVENTS } from './log-event'

const SRC = join(__dirname, '..', '..')
const USER = 'USER-SENTINEL-8a17'
const TENANT = 'TENANT-SENTINEL-8a17'
const ROOM = 'room-SENTINEL-8a17'

/** The source files that ship: no spec, no test support. */
function shipped(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return shipped(path)
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : []
  })
}

describe('logEvent', () => {
  // Scenario: an event is written. Expected: the logger receives one object carrying the code, the text and the fields.
  it('writes an object with the event, the message and the fields', () => {
    const warn = jest.fn()
    const error = jest.fn()
    logEvent({ warn, error }, 'warn', 'REALTIME_HOOK_FAILED', 'a hook failed', {
      hook: 'onConnect',
    })
    logEvent({ warn, error }, 'error', 'REALTIME_HANDSHAKE_FAILED', 'a handshake failed')
    expect(warn).toHaveBeenCalledWith({
      event: 'REALTIME_HOOK_FAILED',
      message: 'a hook failed',
      hook: 'onConnect',
    })
    expect(error).toHaveBeenCalledWith({
      event: 'REALTIME_HANDSHAKE_FAILED',
      message: 'a handshake failed',
    })
  })

  // Scenario: a field is named like the event or the message, or like the error's key. Expected: the event and the
  // message are the library's, and so is `err`. Why: an alert matches on `event`, and a field the library builds must not
  // be able to replace what names the condition.
  it('does not let a field replace the event, the message or the error', () => {
    const warn = jest.fn()
    const cause = new Error('boom')
    logEvent(
      { warn, error: jest.fn() },
      'warn',
      'REALTIME_HOOK_FAILED',
      'a hook failed',
      { event: 'REPLACED', message: 'replaced', err: 'replaced', hook: 'onConnect' } as never,
      cause,
    )
    expect(warn).toHaveBeenCalledWith({
      event: 'REALTIME_HOOK_FAILED',
      message: 'a hook failed',
      hook: 'onConnect',
      err: cause,
    })
  })
})

describe('logEvent and the err key', () => {
  // Scenario: a field is named `err` and the event reports no error. Expected: the line carries no `err` at all. Why:
  // `err` is where the logger's serializer reads an error from, so only the error argument may put anything there.
  it('does not let a field stand for the error when none is passed', () => {
    const warn = jest.fn()
    logEvent({ warn, error: jest.fn() }, 'warn', 'REALTIME_HOOK_FAILED', 'a hook failed', {
      err: 'from a field',
      hook: 'onConnect',
    } as never)
    const [line] = warn.mock.calls[0] as [Record<string, unknown>]
    expect('err' in line).toBe(false)
    expect(line).toEqual({
      event: 'REALTIME_HOOK_FAILED',
      message: 'a hook failed',
      hook: 'onConnect',
    })
  })

  // Scenario: a field is a getter that throws. Expected: logEvent returns and the logger is not called, as the JSDoc
  // says. Why: the line is built inside the guard that absorbs a throw while writing, so the failure being reported
  // is not replaced by this one; the line is lost.
  it('loses the line, without throwing, when reading a field throws', () => {
    const warn = jest.fn()
    const fields = {
      get n(): number {
        throw new Error('getter threw')
      },
    }
    expect(() =>
      logEvent({ warn, error: jest.fn() }, 'warn', 'REALTIME_HOOK_FAILED', 'a hook failed', fields),
    ).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('logEvent and the keys a logger reads as its own', () => {
  // Scenario: fields named `msg` and `level`, with and without an error. Expected: neither reaches the line. Why: a
  // structured logger reads `msg` as the text and `level` as the severity of a line, so a field of either name would
  // change what the line says or how it is filed; `event`, `message` and `err` are the library's alone for the same reason.
  it.each([
    ['no error', undefined],
    ['an error', new Error('boom')],
  ])('drops a field named msg or level, with %s', (_name, error) => {
    const warn = jest.fn()
    logEvent(
      { warn, error: jest.fn() },
      'warn',
      'REALTIME_HOOK_FAILED',
      'a hook failed',
      { msg: 'from a field', level: 'debug', hook: 'onConnect' } as never,
      error,
    )
    const [line] = warn.mock.calls[0] as [Record<string, unknown>]
    expect('msg' in line).toBe(false)
    expect('level' in line).toBe(false)
    expect(line['hook']).toBe('onConnect')
    expect(line['message']).toBe('a hook failed')
  })
})

describe('the event catalog', () => {
  const sources = shipped(SRC).map((path) => readFileSync(path, 'utf8'))

  // Scenario: a code is in the table. Expected: some call site writes it, so the table lists no dead code, and
  // the README documents it, so an operator can find what it means.
  it.each(REALTIME_LOG_EVENTS)(
    '%s is written by the library and documented in the README',
    (code) => {
      const written = sources.filter(
        (text) => text.includes(`'${code}'`) && !text.includes('REALTIME_LOG_EVENTS = ['),
      )
      expect(written.length).toBeGreaterThan(0)
      expect(readFileSync(join(SRC, '..', 'README.md'), 'utf8')).toContain(`\`${code}\``)
    },
  )

  // Scenario: a code is written that the table does not list. Expected: none, so the catalog is the whole set.
  it('lists every code the library writes', () => {
    const used = new Set(
      sources.flatMap((text) => [...text.matchAll(/'(REALTIME_[A-Z_]+)'/g)].map((m) => m[1]!)),
    )
    const events = new Set<string>(REALTIME_LOG_EVENTS)
    const eventCalls = sources.flatMap((text) =>
      [...text.matchAll(/(?:logEvent\([^)]*?|event: )'(REALTIME_[A-Z_]+)'/gs)].map((m) => m[1]!),
    )
    for (const code of eventCalls) expect(events.has(code)).toBe(true)
    expect(used.size).toBeGreaterThan(0)
  })
})

describe('what a warn or error line carries', () => {
  let lines: string[]

  beforeEach(() => {
    lines = []
    const keep = (value: unknown): void => {
      lines.push(JSON.stringify(value))
    }
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(keep)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(keep)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Scenario: the paths that log a warning or an error all run with a user, a tenant and a room that are
  // recognisable. Expected: none of them appears in any line, because the logger's own context carries identity
  // and a host-supplied value is a leak path.
  it('never carries a user id, a tenant id or a room', async () => {
    const reasons: string[] = []
    const { transport, publish } = build({
      sse: { maxQueuedEvents: 1 },
      hooks: {
        onDisconnect: () => {
          throw new Error('hook boom')
        },
        onDeliveryFailure: () => {
          throw new Error('failure hook boom')
        },
      },
      offlineQueue: {
        append: () => Promise.reject(new Error('queue down')),
        retrieveSince: async () => [],
        acknowledge: async () => undefined,
      },
    })
    publish.mockRejectedValue(new Error('bus down'))
    const subject = new Subject<MessageEvent>()
    subject.subscribe((event) => reasons.push(String(event.type)))
    await transport.registerConnection({
      connectionId: 'c1',
      auth: { userId: USER, tenantId: TENANT, rooms: [ROOM] },
      subject,
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: undefined,
      outbound: { written: () => 0, buffered: () => 10 },
    })

    await transport.emitToUser(USER, 'e', 1).catch(() => undefined)
    await transport.emitToUser(USER, 'e', 2).catch(() => undefined)
    await transport.emitToTenant(TENANT, 'e', 1).catch(() => undefined)
    await transport.emitToRoom(ROOM, 'e', 1).catch(() => undefined)
    await transport.unregisterConnection('c1').catch(() => undefined)
    await new Promise((resolve) => setImmediate(resolve))

    expect(lines.length).toBeGreaterThan(0)
    const everything = lines.join('\n')
    for (const sentinel of [USER, TENANT, ROOM]) expect(everything).not.toContain(sentinel)
  })
})

describe('what a log message may carry', () => {
  const sources = shipped(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

  /** The arguments of each `logEvent(` call in a file, split at the top level. */
  function calls(text: string): string[][] {
    const found: string[][] = []
    for (const match of text.matchAll(/logEvent\(/g)) {
      let depth = 1
      let at = (match.index ?? 0) + match[0].length
      const args: string[] = []
      let current = ''
      let quote: string | undefined
      while (depth > 0 && at < text.length) {
        const ch = text[at]!
        if (quote) {
          current += ch
          if (ch === '\\') current += text[++at] ?? ''
          else if (ch === quote) quote = undefined
        } else if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch
          current += ch
        } else {
          if ('([{'.includes(ch)) depth += 1
          if (')]}'.includes(ch)) depth -= 1
          if (depth === 0) break
          if (ch === ',' && depth === 1) {
            args.push(current.trim())
            current = ''
          } else current += ch
        }
        at += 1
      }
      if (current.trim()) args.push(current.trim())
      found.push(args)
    }
    return found
  }

  // Scenario: every line the library writes through `logEvent`. Expected: the message is the library's own text. An
  // error raised by host code can carry a user or a tenant, so it is never read into the message (no `describeError`,
  // no `.message`, no placeholder named for an error or a reason): it is the sixth argument, written under `err`.
  it('never reads an error into the message of an event', () => {
    let checked = 0
    for (const { path, text } of sources) {
      if (path.endsWith('log-event.ts')) continue
      for (const args of calls(text)) {
        if (args.length < 4) continue
        checked += 1
        const message = args[3]!
        expect({ path, message }).toEqual({
          path,
          message: expect.not.stringMatching(
            /describeError|\.message|\$\{[^}]*\b(err|error|reason|failed|cause)\b/i,
          ),
        })
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('does not call describeError for text that reaches a log', () => {
    const offenders = sources
      .filter(({ path }) => !path.endsWith('log-event.ts'))
      .filter(({ text }) =>
        calls(text).some((args) => args.some((arg) => arg.includes('describeError'))),
      )
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })
})
