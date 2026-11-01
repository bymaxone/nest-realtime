/**
 * @fileoverview Tests for resolveClientAddress, which turns the address channels of an SSE request
 * into one validated client address, and for the connection context it feeds over a real HTTP
 * request.
 * @layer utils
 */
import { isIP } from 'node:net'
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { IConnectionAuthenticator } from '../interfaces/connection-authenticator.interface'
import { BymaxRealtimeModule } from '../realtime.module'
import { resolveClientAddress } from './client-address'

describe('resolveClientAddress', () => {
  describe('over hand-built requests', () => {
    // Scenario: req.ip is an address. Expected: it is returned unchanged, whatever its family.
    it.each(['203.0.113.4', '2001:db8::7', '::ffff:198.51.100.7', '::1'])(
      'returns the address %s unchanged',
      (ip) => {
        expect(resolveClientAddress({ ip, ips: [ip], socket: { remoteAddress: '10.0.0.1' } })).toBe(
          ip,
        )
      },
    )

    // Scenario: req.ip is a string the caller wrote and the next hop toward the socket is an
    // address. Expected: that hop. Why: `req.ips` runs from the client end toward the socket, so
    // the entry after the first is the nearest trusted hop.
    it('resolves a non-address client entry to the nearest trusted hop', () => {
      expect(
        resolveClientAddress({
          ip: 'garbage',
          ips: ['garbage', '10.0.0.2', '10.0.0.3'],
          socket: { remoteAddress: '10.0.0.1' },
        }),
      ).toBe('10.0.0.2')
    })

    // Scenario: a non-address client entry with no trusted hop recorded in `ips`. Expected: the
    // socket peer, which is the hop that delivered the request.
    it('falls back to the socket peer when no hop in ips is an address', () => {
      expect(
        resolveClientAddress({
          ip: 'not-an-ip',
          ips: ['not-an-ip'],
          socket: { remoteAddress: '10.0.0.1' },
        }),
      ).toBe('10.0.0.1')
    })

    // Scenario: entries after the first are not addresses either. Expected: the walk continues to
    // the first that is, rather than stopping at the second candidate.
    it('keeps walking past further entries that are not addresses', () => {
      expect(
        resolveClientAddress({
          ip: 'junk',
          ips: ['junk', 'also-junk', '10.0.0.3'],
          socket: { remoteAddress: '10.0.0.1' },
        }),
      ).toBe('10.0.0.3')
    })

    // Scenario: nothing is an address. Expected: an empty string, which callers read as "no
    // address".
    it.each([
      [{}],
      [{ ip: '', ips: [], socket: { remoteAddress: '' } }],
      [{ ip: 'junk', ips: ['junk'], socket: { remoteAddress: 'also junk' } }],
      [{ ip: undefined, ips: undefined, socket: undefined }],
      [{ ip: 'junk', ips: ['junk', 7 as unknown as string], socket: {} }],
    ])('returns an empty string when there is no address to be had: %j', (source) => {
      expect(resolveClientAddress(source)).toBe('')
    })

    // Scenario: a header-derived entry carries a zone index. Expected: it is not an address, so
    // the walk ends at the last hop that was one. Why: `isIP` accepts a zone of any length, and a
    // zone names an interface on the machine that wrote it, so it means nothing across hops.
    it.each(['fe80::1%eth0', `fe80::1%${'z'.repeat(5000)}`])(
      'treats the header entry %.20s as a non-address and resolves to the next hop',
      (entry) => {
        expect(
          resolveClientAddress({
            ip: entry,
            ips: [entry, '10.0.0.2'],
            socket: { remoteAddress: '10.0.0.1' },
          }),
        ).toBe('10.0.0.2')
      },
    )

    // Scenario: the socket peer carries a zone, as a link-local peer is reported. Expected: the
    // bare address, because the zone is scope rather than identity.
    it.each([
      ['fe80::2%en0', 'fe80::2'],
      [`fe80::2%${'z'.repeat(5000)}`, 'fe80::2'],
    ])('cuts the zone index from the socket peer %.20s', (peer, expected) => {
      const resolved = resolveClientAddress({
        ip: 'junk',
        ips: ['junk'],
        socket: { remoteAddress: peer },
      })

      expect(resolved).toBe(expected)
      expect(resolved.length).toBeLessThanOrEqual(45)
    })

    // Scenario: a link-local peer with no trust proxy set, where Express reports the zoned socket
    // address as `req.ip`. Expected: the bare address, through the peer path.
    it('resolves a zoned req.ip that is the peer itself to the bare address', () => {
      expect(
        resolveClientAddress({
          ip: 'fe80::3%en0',
          ips: [],
          socket: { remoteAddress: 'fe80::3%en0' },
        }),
      ).toBe('fe80::3')
    })

    // Scenario: a `%` suffix on something that is not IPv6, on either channel. Expected: not an
    // address. Why: only an IPv6 literal carries a zone, and accepting the rest would turn
    // caller-written text into an address.
    it('does not accept a zone suffix on an IPv4 literal', () => {
      expect(
        resolveClientAddress({
          ip: '1.2.3.4%eth0',
          ips: [],
          socket: { remoteAddress: '5.6.7.8%eth0' },
        }),
      ).toBe('')
    })

    // Scenario: an ordinary request on a host that never set `trust proxy`. Expected: Express
    // leaves `ips` empty and `ip` is the socket address, which is what is returned.
    it('returns the socket address when trust proxy is unset', () => {
      expect(
        resolveClientAddress({ ip: '10.0.0.9', ips: [], socket: { remoteAddress: '10.0.0.9' } }),
      ).toBe('10.0.0.9')
    })
  })

  // The fixtures above describe what Express produces; this block checks that they do, end to end:
  // a real application with a `trust proxy` setting, a real SSE request carrying a forwarded
  // header, and the `ip` the authenticator and the `onConnect` hook receive. A change in how
  // Express fills `req.ip` and `req.ips`, or in what the endpoint reads, fails here and not in
  // production.
  describe('over a real SSE request', () => {
    interface Seen {
      authenticateIp?: string
      hookIp?: string
    }

    async function connectBehind(
      trustProxy: string | undefined,
      forwardedFor: string | undefined,
    ): Promise<Seen> {
      const seen: Seen = {}
      const authenticator: IConnectionAuthenticator = {
        authenticate: (context) => {
          seen.authenticateIp = context.ip
          return Promise.resolve({ userId: 'u1' })
        },
      }
      const moduleRef = await Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRoot({
            transport: 'sse',
            authenticator,
            hooks: {
              onConnect: (meta) => {
                seen.hookIp = meta.ip
              },
            },
          }),
        ],
      }).compile()
      const app = moduleRef.createNestApplication<NestExpressApplication>()
      if (trustProxy !== undefined) app.set('trust proxy', trustProxy)
      await app.listen(0, '127.0.0.1')
      const port = (app.getHttpServer().address() as AddressInfo).port
      try {
        await new Promise<void>((resolve, reject) => {
          const req = get(
            {
              host: '127.0.0.1',
              port,
              path: '/realtime/sse',
              headers: {
                accept: 'text/event-stream',
                ...(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }),
              },
              agent: false,
            },
            (res) => {
              res.once('data', () => {
                setTimeout(() => {
                  req.destroy()
                  resolve()
                }, 50)
              })
            },
          )
          req.on('error', (error: NodeJS.ErrnoException) =>
            error.code === 'ECONNRESET' ? resolve() : reject(error),
          )
        })
      } finally {
        await app.close()
      }
      return seen
    }

    // Scenario: the decisive case. The application trusts the loopback proxy in front of it and
    // the client forges the first entry; the proxy appended the real address. Expected: the
    // address Express reports, which is also what the hook receives. Why: the leftmost entry is
    // written by the client, and `trust proxy` decides how far the header is believed.
    it('reports the address trust proxy produced, not the forged leftmost entry', async () => {
      const seen = await connectBehind('loopback', '6.6.6.6, 203.0.113.9')

      expect(seen.authenticateIp).toBe('203.0.113.9')
      expect(seen.hookIp).toBe('203.0.113.9')
    })

    // Scenario: the header holds text that is not an address, behind a trusted proxy. Expected: an
    // address, never the text. Why: the value reaches logs, audit events and rate-limit keys.
    it.each(["junk'; DROP TABLE x;--", 'not-an-ip'])(
      'never reports the header text %s as the address',
      async (forwarded) => {
        const seen = await connectBehind('loopback', forwarded)

        expect(isIP(seen.authenticateIp ?? '')).not.toBe(0)
        expect(seen.authenticateIp).not.toContain('junk')
      },
    )

    // Scenario: a direct deployment, with no `trust proxy` set, and a client that sends the header
    // anyway. Expected: the socket's own address. Why: with no proxy to believe, the header is
    // only the client's claim.
    it('ignores the header when trust proxy is not set', async () => {
      const seen = await connectBehind(undefined, '6.6.6.6')

      expect(isIP(seen.authenticateIp ?? '')).not.toBe(0)
      expect(seen.authenticateIp).not.toBe('6.6.6.6')
    })

    // Scenario: no forwarded header. Expected: the peer is the client.
    it('reports the peer when there is no forwarded header', async () => {
      const seen = await connectBehind('loopback', undefined)

      expect(isIP(seen.authenticateIp ?? '')).not.toBe(0)
    })
  })
})
