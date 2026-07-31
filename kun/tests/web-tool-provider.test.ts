import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import {
  buildWebToolProviders,
  FetchWebProvider,
  type FetchWebTransportResponse
} from '../src/adapters/tool/web-tool-provider.js'
import {
  buildRuntimeCapabilityManifest,
  KunCapabilitiesConfig,
  type WebCapabilityConfig
} from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'
import { DeterministicWebProvider } from '../src/ports/web-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/project',
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function deterministicProvider() {
  return new DeterministicWebProvider({
    id: 'test-search',
    nowIso: () => '2026-06-03T00:00:00.000Z',
    pages: {
      'https://docs.example.test/page': {
        url: 'https://docs.example.test/page',
        finalUrl: 'https://docs.example.test/page',
        title: 'Docs Page',
        contentType: 'text/plain',
        text: 'Current docs content'
      }
    },
    searchResults: {
      'kun web': [
        {
          url: 'https://docs.example.test/page',
          title: 'Kun Web Docs',
          snippet: 'How Kun web access works.'
        }
      ]
    }
  })
}

type TestFetchResponse = {
  status?: number
  body?: string
  contentType?: string
  location?: string
}

function fetchProvider(
  config: WebCapabilityConfig,
  responses: Record<string, TestFetchResponse>,
  options: {
    resolveHost?: (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>
    onRequest?: (url: URL) => void
  } = {}
) {
  return new FetchWebProvider(config, {
    nowIso: () => '2026-06-03T00:00:00.000Z',
    resolveHost: options.resolveHost ?? (async () => [{ address: '93.184.216.34', family: 4 }]),
    request: async ({ url }) => {
      options.onRequest?.(url)
      const response = responses[url.href]
      if (!response) throw new Error(`missing test response for ${url.href}`)
      return responseForTest(response)
    }
  })
}

function responseForTest(response: TestFetchResponse): FetchWebTransportResponse {
  return {
    status: response.status ?? 200,
    contentType: response.contentType,
    location: response.location,
    body: bodyForTest(response.body ?? ''),
    cancel: () => undefined
  }
}

async function* bodyForTest(body: string): AsyncGenerator<Uint8Array> {
  yield Buffer.from(body)
}

describe('Web tool provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not advertise web tools when web access is disabled', async () => {
    const config = KunCapabilitiesConfig.parse({})
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })

    expect(built.providers).toEqual([])
    expect(built.fetchAvailable).toBe(false)
    expect(built.searchAvailable).toBe(false)
  })

  it('owns one-hour request timeouts and ignores stale model timeout arguments', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'test-search',
        allowDomains: ['docs.example.test']
      }
    })
    const provider = deterministicProvider()
    const timeoutValues: number[] = []
    const fetch = provider.fetch.bind(provider)
    const search = provider.search.bind(provider)
    provider.fetch = async (request) => {
      timeoutValues.push(request.timeoutMs)
      return fetch(request)
    }
    provider.search = async (request) => {
      timeoutValues.push(request.timeoutMs)
      return search(request)
    }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const tools = await host.listTools(buildContext())
    for (const tool of tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty('timeout_ms')
    }
    await host.execute({
      callId: 'call_fetch_timeout',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page', timeout_ms: 1 }
    }, buildContext())
    await host.execute({
      callId: 'call_search_timeout',
      toolName: 'web_search',
      arguments: { query: 'kun web', timeout_ms: 1 }
    }, buildContext())

    expect(timeoutValues).toEqual([3_600_000, 3_600_000])
  })

  it('fetches allowed URLs with source metadata and telemetry', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['web_fetch'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page' }
    }, buildContext())

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.isError).toBe(false)
      const output = result.item.output as {
        sourceId: string
        text: string
        sources: Array<{ sourceId: string; url: string; retrievedAt: string }>
        citations: Array<{ sourceId: string }>
        telemetry: { policy: string; provider: string; byteCount: number }
      }
      expect(output.text).toBe('Current docs content')
      expect(output.sources[0]).toMatchObject({
        sourceId: output.sourceId,
        url: 'https://docs.example.test/page',
        retrievedAt: '2026-06-03T00:00:00.000Z'
      })
      expect(output.citations[0]?.sourceId).toBe(output.sourceId)
      expect(output.telemetry).toMatchObject({
        policy: 'allowed',
        provider: 'test-search',
        byteCount: 20
      })
    }
  })

  it('truncates instead of failing when content-length exceeds max_bytes', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test'],
        maxFetchBytes: 10
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: fetchProvider(config.web, {
          'https://docs.example.test/large': {
            body: 'abcdefghijklmnopqrstuvwxyz',
            contentType: 'text/plain'
          }
        })
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/large', max_bytes: 10 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        text: 'abcdefghij',
        byteCount: 10,
        truncated: true
      })
    }
  })

  it('truncates oversized fetch responses via streaming when content-length is unknown', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test'],
        maxFetchBytes: 10
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: fetchProvider(config.web, {
          'https://docs.example.test/large': {
            body: 'abcdefghijklmnopqrstuvwxyz',
            contentType: 'text/plain'
          }
        })
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/large', max_bytes: 10 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        text: 'abcdefghij',
        byteCount: 10,
        truncated: true,
        telemetry: {
          policy: 'allowed',
          provider: 'fetch',
          byteCount: 10
        }
      })
    }
  })

  it('raises tiny model-passed max_bytes budgets to a usable floor', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: fetchProvider(config.web, {
          'https://docs.example.test/page': {
            body: 'x'.repeat(3000),
            contentType: 'text/plain'
          }
        })
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page', max_bytes: 2000 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        byteCount: 3000,
        truncated: false
      })
    }
  })

  it('extracts HTML text without turning escaped tags into markup', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: fetchProvider(config.web, {
          'https://docs.example.test/html': {
            body: [
              '<!doctype html>',
              '<title>Docs &amp; Safety</title>',
              '<script>alert("secret")</script>',
              '<style>body{display:none}</style>',
              '<h1>Hello&nbsp;World</h1>',
              '<p>A &lt;script&gt; stays text.</p>',
              '<div>Next &#60;b&#62; line &amp; more.</div>'
            ].join(''),
            contentType: 'text/html'
          }
        })
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/html' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { title?: string; text: string }
      expect(output.title).toBe('Docs & Safety')
      expect(output.text).toContain('Hello World')
      expect(output.text).not.toContain('alert')
      expect(output.text).not.toContain('<script>')
      expect(output.text).toContain('&lt;script&gt; stays text.')
      expect(output.text).toContain('Next &#60;b&#62; line & more.')
    }
  })

  it('rejects disallowed fetch URLs before contacting the provider', async () => {
    let contacted = false
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        denyDomains: ['blocked.example.test']
      }
    })
    const provider = new DeterministicWebProvider({
      pages: {
        'https://blocked.example.test/page': {
          url: 'https://blocked.example.test/page',
          finalUrl: 'https://blocked.example.test/page',
          text: 'secret'
        }
      }
    })
    provider.fetch = async (request) => {
      contacted = true
      return DeterministicWebProvider.prototype.fetch.call(provider, request)
    }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://blocked.example.test/page' }
    }, buildContext())

    expect(contacted).toBe(false)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      })
    }
  })

  it('rejects loopback, private, link-local, metadata, and encoded IP fetch targets before contacting the provider', async () => {
    let contacted = false
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true
      }
    })
    const provider = new DeterministicWebProvider()
    provider.fetch = async () => {
      contacted = true
      throw new Error('must not be called')
    }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })
    const blockedUrls = [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost./',
      `http://localhost${'.'.repeat(10_000)}/`,
      'http://metadata.google.internal/computeMetadata/v1/'
    ]

    for (const [index, url] of blockedUrls.entries()) {
      const result = await host.execute({
        callId: `call_blocked_${index}`,
        toolName: 'web_fetch',
        arguments: { url }
      }, buildContext())
      expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
      if (result.item.kind === 'tool_result') {
        expect(result.item.output).toMatchObject({
          error: { code: 'policy_blocked' },
          telemetry: { policy: 'blocked' }
        })
      }
    }
    expect(contacted).toBe(false)
  })

  it('rejects hostnames with any non-public DNS answer before opening a socket', async () => {
    let contacted = false
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const provider = fetchProvider(config.web, {
      'https://docs.example.test/page': { body: 'must not be read' }
    }, {
      resolveHost: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.7', family: 4 }
      ],
      onRequest: () => {
        contacted = true
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_dns_private',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page' }
    }, buildContext())

    expect(contacted).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      }
    })
  })

  it('revalidates each redirect and never requests a private redirect target', async () => {
    const requested: string[] = []
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['example.test']
      }
    })
    const provider = fetchProvider(config.web, {
      'https://start.example.test/page': {
        status: 302,
        location: 'https://redirect.example.test/private'
      }
    }, {
      resolveHost: async (hostname) => hostname === 'redirect.example.test'
        ? [{ address: '10.0.0.7', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
      onRequest: (url) => requested.push(url.href)
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_redirect_private',
      toolName: 'web_fetch',
      arguments: { url: 'https://start.example.test/page' }
    }, buildContext())

    expect(requested).toEqual(['https://start.example.test/page'])
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      }
    })
  })

  it('pins the vetted DNS answer into each allowed redirect request and caps redirect chains', async () => {
    const pinnedAddresses: string[] = []
    const requested: string[] = []
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['example.test']
      }
    })
    const provider = new FetchWebProvider(config.web, {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async ({ url, lookup }) => {
        requested.push(url.href)
        await new Promise<void>((resolve, reject) => {
          lookup(url.hostname, { family: 4 }, (error, address, family) => {
            if (error) {
              reject(error)
              return
            }
            expect(family).toBe(4)
            expect(address).toBe('93.184.216.34')
            pinnedAddresses.push(String(address))
            resolve()
          })
        })
        return responseForTest({
          status: 302,
          location: `/hop-${requested.length}`
        })
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_redirect_limit',
      toolName: 'web_fetch',
      arguments: { url: 'https://start.example.test/page' }
    }, buildContext())

    // One initial request plus five permitted hops; the sixth redirect is
    // rejected without opening a seventh connection.
    expect(requested).toHaveLength(6)
    expect(pinnedAddresses).toEqual(Array(6).fill('93.184.216.34'))
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { error: { code: 'fetch_failed' } }
    })
  })

  it('returns unavailable-provider errors for search without a search provider', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'missing'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'kun web' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: {
          code: 'provider_unavailable',
          message: 'web search provider is unavailable'
        }
      })
    }
  })

  it('searches through a configured provider with citations and telemetry', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'kun web', limit: 3 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as {
        results: Array<{ sourceId: string; url: string; provider: string; rank: number }>
        sources: Array<{ sourceId: string }>
        telemetry: { resultCount: number; provider: string }
      }
      expect(output.results[0]).toMatchObject({
        url: 'https://docs.example.test/page',
        provider: 'test-search',
        rank: 1
      })
      expect(output.sources[0]?.sourceId).toBe(output.results[0]?.sourceId)
      expect(output.telemetry).toMatchObject({
        resultCount: 1,
        provider: 'test-search'
      })
    }
  })

  it('reports web availability in the runtime capability manifest', () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })
    const manifest = buildRuntimeCapabilityManifest({
      config,
      model: modelCapabilitiesForModel('deepseek-chat'),
      web: {
        fetchAvailable: built.fetchAvailable,
        searchAvailable: built.searchAvailable,
        provider: built.provider
      }
    })

    expect(manifest.web.available).toBe(true)
    expect(manifest.web.fetch.available).toBe(true)
    expect(manifest.web.search.available).toBe(true)
    expect(manifest.web.provider).toBe('test-search')
  })
})
