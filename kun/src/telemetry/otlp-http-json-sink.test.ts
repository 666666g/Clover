import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentObservabilitySpan } from './agent-observability.js'
import {
  OtlpHttpJsonAgentObservabilitySink,
  parseOtlpHeaders,
  resolveOtlpTracesEndpoint
} from './otlp-http-json-sink.js'

describe('OtlpHttpJsonAgentObservabilitySink', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports valid OTLP JSON without adding content fields', async () => {
    const calls: Array<Parameters<typeof globalThis.fetch>> = []
    const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      calls.push([input, init])
      return new Response(null, { status: 200 })
    })
    const sink = new OtlpHttpJsonAgentObservabilitySink({
      endpoint: 'https://collector.example/v1/traces',
      headers: { authorization: 'Bearer token' },
      fetch
    })

    sink.emit(span())
    await sink.flush()

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = calls[0]!
    expect(url).toBe('https://collector.example/v1/traces')
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer token'
    })
    const payload = JSON.parse(String(init?.body))
    const exported = payload.resourceSpans[0].scopeSpans[0].spans[0]
    expect(exported).toMatchObject({
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      kind: 1,
      status: { code: 1 }
    })
    expect(exported.attributes).toContainEqual({
      key: 'gen_ai.usage.input_tokens',
      value: { intValue: '42' }
    })
    expect(JSON.stringify(payload)).not.toContain('prompt')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('uses signal endpoint as-is and appends the traces path to common endpoints', () => {
    expect(resolveOtlpTracesEndpoint({ tracesEndpoint: 'https://a.test/custom' })).toBe('https://a.test/custom')
    expect(resolveOtlpTracesEndpoint({ commonEndpoint: 'https://a.test/otel/' })).toBe('https://a.test/otel/v1/traces')
    expect(resolveOtlpTracesEndpoint({})).toBe('http://localhost:4318/v1/traces')
  })

  it('parses percent-encoded standard OTLP headers', () => {
    expect(parseOtlpHeaders('api-key=hello%20world,x-tenant=kun')).toEqual({
      'api-key': 'hello world',
      'x-tenant': 'kun'
    })
  })

  it('does not retry a permanently rejected batch', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => new Response(null, { status: 400 }))
    const sink = new OtlpHttpJsonAgentObservabilitySink({ fetch })

    sink.emit(span())
    await sink.flush()
    await sink.flush()

    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([500, 501])('does not retry non-retryable OTLP HTTP %s responses', async (status) => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => new Response(null, { status }))
    const sink = new OtlpHttpJsonAgentObservabilitySink({ fetch })

    sink.emit(span())
    await sink.flush()
    await sink.flush()

    expect(fetch).toHaveBeenCalledOnce()
    await sink.shutdown()
  })

  it('retries HTTP 503 after the collector Retry-After delay', async () => {
    vi.useFakeTimers()
    const fetch: typeof globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 503,
        headers: { 'retry-after': '2' }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const sink = new OtlpHttpJsonAgentObservabilitySink({ fetch, random: () => 0 })

    sink.emit(span())
    await sink.flush()
    expect(fetch).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    await sink.shutdown()
  })

  it('honors the hard timeout when fetch ignores AbortSignal', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetch: typeof globalThis.fetch = vi.fn((_input, init) => {
      signal = init?.signal
      return new Promise<Response>(() => undefined)
    })
    const sink = new OtlpHttpJsonAgentObservabilitySink({ timeoutMs: 25, fetch })

    sink.emit(span())
    const shutdown = sink.shutdown()
    await vi.advanceTimersByTimeAsync(25)

    await expect(shutdown).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(true)
  })

  it('retries an in-flight transient batch while shutdown drains', async () => {
    let resolveFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    let requestCount = 0
    const fetch: typeof globalThis.fetch = vi.fn(async () => {
      requestCount += 1
      return requestCount === 1
        ? await firstResponse
        : new Response(null, { status: 200 })
    })
    const sink = new OtlpHttpJsonAgentObservabilitySink({ timeoutMs: 1_000, fetch })

    sink.emit(span())
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledOnce()

    const shutdown = sink.shutdown()
    expect(sink.shutdown()).toBe(shutdown)
    resolveFirst(new Response(null, { status: 503 }))

    await expect(shutdown).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('drains every queued batch during shutdown', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 }))
    const sink = new OtlpHttpJsonAgentObservabilitySink({ batchSize: 1, fetch })

    sink.emit(span())
    sink.emit({ ...span(), spanId: '3'.repeat(16) })
    sink.emit({ ...span(), spanId: '4'.repeat(16) })
    await sink.shutdown()

    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

function span(): AgentObservabilitySpan {
  return {
    schemaUrl: 'https://opentelemetry.io/schemas/1.37.0',
    traceId: '1'.repeat(32),
    spanId: '2'.repeat(16),
    name: 'kun.turn',
    kind: 'internal',
    startTimeUnixNano: '1000000',
    endTimeUnixNano: '2000000',
    durationMs: 1,
    status: { code: 'OK' },
    attributes: {
      'gen_ai.usage.input_tokens': 42,
      'kun.cache.hit_rate': 0.5
    }
  }
}
