import { createServer } from 'node:http'
import type { LookupFunction } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  brokeredNetworkMode,
  classifyBrokerAddress,
  createPinnedLookup,
  createSafeNetworkFetch,
  resolveBrokeredNetworkTarget,
  type BrokerDnsResolver,
  type BrokerResolvedAddress
} from './safe-network-fetch.js'

describe('safe Extension broker network fetch', () => {
  it.each([
    ['8.8.8.8', true, false, 'unicast'],
    ['0.0.0.0', false, false, 'unspecified'],
    ['127.0.0.1', false, true, 'loopback'],
    ['10.0.0.1', false, false, 'private'],
    ['100.64.0.1', false, false, 'carrierGradeNat'],
    ['169.254.1.1', false, false, 'linkLocal'],
    ['192.0.2.1', false, false, 'reserved'],
    ['192.31.196.1', false, false, 'as112'],
    ['192.52.193.1', false, false, 'amt'],
    ['198.18.0.1', false, false, 'reserved'],
    ['224.0.0.1', false, false, 'multicast'],
    ['240.0.0.1', false, false, 'reserved'],
    ['2606:4700:4700::1111', true, false, 'unicast'],
    ['::', false, false, 'unspecified'],
    ['::1', false, true, 'loopback'],
    ['fc00::1', false, false, 'uniqueLocal'],
    ['fe80::1', false, false, 'linkLocal'],
    ['ff02::1', false, false, 'multicast'],
    ['2001:db8::1', false, false, 'reserved'],
    ['2001:2::1', false, false, 'benchmarking'],
    ['64:ff9b::7f00:1', false, false, 'rfc6052'],
    ['2002:7f00:1::', false, false, '6to4'],
    ['2001::ffff:7f00:1', false, false, 'teredo'],
    ['::ffff:127.0.0.1', false, true, 'loopback'],
    ['::ffff:10.0.0.1', false, false, 'private'],
    ['::ffff:8.8.8.8', true, false, 'unicast']
  ])('classifies %s without treating special ranges as public', (
    address,
    publicUnicast,
    loopback,
    range
  ) => {
    expect(classifyBrokerAddress(address)).toMatchObject({ publicUnicast, loopback, range })
  })

  it('accepts HTTPS generally but only explicit loopback hosts over HTTP', () => {
    expect(brokeredNetworkMode(new URL('https://api.example.test/path'))).toBe('remote-https')
    expect(brokeredNetworkMode(new URL('http://localhost:8080/path'))).toBe('loopback-http')
    expect(brokeredNetworkMode(new URL('http://127.0.0.1:8080/path'))).toBe('loopback-http')
    expect(brokeredNetworkMode(new URL('http://[::1]:8080/path'))).toBe('loopback-http')
    expect(() => brokeredNetworkMode(new URL('http://127.0.0.2/path'))).toThrow(/require HTTPS/)
    expect(() => brokeredNetworkMode(new URL('http://10.0.0.1/path'))).toThrow(/require HTTPS/)
    expect(() => brokeredNetworkMode(new URL('https://user:pass@example.test/path')))
      .toThrow(/must not contain credentials/)
  })

  it('fails closed when any DNS result is private, including mixed and mapped answers', async () => {
    const cases: readonly BrokerResolvedAddress[][] = [
      [{ address: '10.0.0.7', family: 4 }],
      [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }],
      [{ address: '2606:4700:4700::1111', family: 6 }, { address: 'fc00::1', family: 6 }],
      [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:10.0.0.7', family: 6 }]
    ]
    for (const answers of cases) {
      await expect(resolveBrokeredNetworkTarget(
        new URL('https://api.example.test/resource'),
        async () => answers
      )).rejects.toThrow(/resolved to blocked/)
    }
  })

  it('requires every localhost DNS result to remain loopback', async () => {
    await expect(resolveBrokeredNetworkTarget(
      new URL('http://localhost:8080/resource'),
      async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ]
    )).resolves.toMatchObject({ mode: 'loopback-http' })

    await expect(resolveBrokeredNetworkTarget(
      new URL('http://localhost:8080/resource'),
      async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '192.168.1.2', family: 4 }
      ]
    )).rejects.toThrow(/resolved to blocked private address/)
  })

  it('pins the validated answer and revalidates a changed DNS answer on the next request', async () => {
    let resolution = 0
    const resolver: BrokerDnsResolver = async () => {
      resolution += 1
      return resolution === 1
        ? [{ address: '8.8.8.8', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }]
    }
    const first = await resolveBrokeredNetworkTarget(
      new URL('https://api.example.test/resource'),
      resolver
    )
    const pinned = createPinnedLookup(first.hostname, first.addresses)
    await expect(runLookup(pinned, 'api.example.test', { all: true }))
      .resolves.toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(resolution).toBe(1)

    await expect(resolveBrokeredNetworkTarget(
      new URL('https://api.example.test/next'),
      resolver
    )).rejects.toThrow(/blocked loopback/)
    expect(resolution).toBe(2)
    await expect(runLookup(pinned, 'other.example.test', { all: true }))
      .rejects.toMatchObject({ code: 'ENOTFOUND' })
  })

  it('hands the validated localhost address to the real connection lookup', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(`safe:${request.headers.host ?? ''}`)
    })
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
      let lookups = 0
      const safeFetch = createSafeNetworkFetch({
        resolve: async (hostname) => {
          lookups += 1
          expect(hostname).toBe('localhost')
          return [{ address: '127.0.0.1', family: 4 }]
        }
      })
      const response = await safeFetch(`http://localhost:${address.port}/probe`, {
        redirect: 'manual'
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(`safe:localhost:${address.port}`)
      expect(lookups).toBe(1)
    } finally {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
      })
    }
  })

  it('blocks a remote HTTPS private answer before attempting a connection', async () => {
    let resolved = false
    const safeFetch = createSafeNetworkFetch({
      resolve: async () => {
        resolved = true
        return [{ address: '169.254.169.254', family: 4 }]
      }
    })
    await expect(safeFetch('https://metadata.example.test/latest', { redirect: 'manual' }))
      .rejects.toThrow(/blocked linkLocal/)
    expect(resolved).toBe(true)
  })

  it('requires callers to handle every redirect hop explicitly', async () => {
    const safeFetch = createSafeNetworkFetch({
      resolve: async () => [{ address: '8.8.8.8', family: 4 }]
    })
    await expect(safeFetch('https://api.example.test/resource'))
      .rejects.toThrow(/manual or error redirect handling/)
  })
})

function runLookup(
  lookup: LookupFunction,
  hostname: string,
  options: Parameters<LookupFunction>[1]
): Promise<string | import('node:dns').LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address) => {
      if (error) reject(error)
      else resolve(address)
    })
  })
}
