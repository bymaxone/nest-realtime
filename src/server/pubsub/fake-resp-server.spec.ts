/**
 * @fileoverview The scripted RESP server's command framing: a command is read whole however TCP
 * cut the stream, because a half command answered as if it were a command desynchronises the
 * client and shows up only on a platform that segments differently.
 * @layer test
 */
import { RespCommandParser } from '../../../test/fixtures/fake-resp-server'

const SUBSCRIBE = '*2\r\n$9\r\nsubscribe\r\n$14\r\nbymax:realtime\r\n'
const HELLO = '*5\r\n$5\r\nhello\r\n$1\r\n3\r\n$4\r\nAUTH\r\n$7\r\ndefault\r\n$1\r\nx\r\n'

describe('RespCommandParser', () => {
  // One command in one chunk comes out with its words upper-cased.
  it('reads a whole command', () => {
    expect(new RespCommandParser().push(SUBSCRIBE)).toEqual([['SUBSCRIBE', 'BYMAX:REALTIME']])
  })

  // Several commands written back to back arrive in one chunk and come out in order.
  it('reads every command in one chunk, in order', () => {
    expect(new RespCommandParser().push(HELLO + SUBSCRIBE)).toEqual([
      ['HELLO', '3', 'AUTH', 'DEFAULT', 'X'],
      ['SUBSCRIBE', 'BYMAX:REALTIME'],
    ])
  })

  // The same stream cut at every possible byte gives the same commands, and nothing is emitted
  // for a half command.
  it.each(Array.from({ length: SUBSCRIBE.length + HELLO.length - 1 }, (_value, cut) => cut + 1))(
    'gives the same commands when the stream is cut at byte %i',
    (cut) => {
      const stream = HELLO + SUBSCRIBE
      const parser = new RespCommandParser()
      const commands = [...parser.push(stream.slice(0, cut)), ...parser.push(stream.slice(cut))]
      expect(commands).toEqual([
        ['HELLO', '3', 'AUTH', 'DEFAULT', 'X'],
        ['SUBSCRIBE', 'BYMAX:REALTIME'],
      ])
    },
  )

  // A byte at a time, the slowest segmentation there is.
  it('gives the same commands when the stream arrives one byte at a time', () => {
    const parser = new RespCommandParser()
    const commands = [...(HELLO + SUBSCRIBE)].flatMap((byte) => parser.push(byte))
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(['SUBSCRIBE', 'BYMAX:REALTIME'])
  })

  // Bytes that are not an array of bulk strings are held, not answered as a command.
  it('holds input that is not a command header', () => {
    expect(new RespCommandParser().push('PING\r\n')).toEqual([])
  })
})
