import type {
  AgentObservabilityAttributeValue,
  AgentObservabilitySink,
  AgentObservabilitySpan
} from './agent-observability.js'

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_BATCH_SIZE = 64
const DEFAULT_MAX_QUEUE_SIZE = 2_048
const MAX_RETRY_DELAY_MS = 30_000
const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504])

class PermanentOtlpExportError extends Error {}

class RetryableOtlpExportError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message)
  }
}

export type OtlpHttpJsonSinkOptions = {
  endpoint?: string
  headers?: Record<string, string>
  timeoutMs?: number
  batchSize?: number
  maxQueueSize?: number
  fetch?: typeof globalThis.fetch
  random?: () => number
}

/**
 * A bounded, non-blocking OTLP/HTTP JSON exporter. Runtime event persistence
 * must never wait for an external collector, so emit only queues work and a
 * single background worker owns delivery and retry ordering.
 */
export class OtlpHttpJsonAgentObservabilitySink implements AgentObservabilitySink {
  private readonly endpoint: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly batchSize: number
  private readonly maxQueueSize: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly random: () => number
  private queue: AgentObservabilitySpan[] = []
  private scheduled = false
  private inFlight: Promise<void> | undefined
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private warnedAboutOverflow = false
  private warnedAfterShutdown = false
  private closed = false
  private shutdownPromise: Promise<void> | undefined

  constructor(options: OtlpHttpJsonSinkOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_OTLP_ENDPOINT
    this.headers = options.headers ?? {}
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.random = options.random ?? Math.random
  }

  emit(span: AgentObservabilitySpan): void {
    if (this.closed) {
      if (!this.warnedAfterShutdown) {
        this.warnedAfterShutdown = true
        console.warn('[kun] OTLP trace exporter is closed; dropping late spans')
      }
      return
    }
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift()
      if (!this.warnedAboutOverflow) {
        this.warnedAboutOverflow = true
        console.warn('[kun] OTLP trace queue full; dropping oldest spans')
      }
    }
    this.queue.push(span)
    this.scheduleFlush()
  }

  async flush(): Promise<void> {
    if (this.closed) return this.shutdownPromise ?? this.inFlight
    if (this.inFlight) return this.inFlight
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.queue.length === 0) return

    const batch = this.queue.splice(0, this.batchSize)
    this.inFlight = this.exportBatch(batch)
      .then(() => {
        this.retryAttempt = 0
        this.warnedAboutOverflow = false
      })
      .catch((error: unknown) => {
        if (error instanceof PermanentOtlpExportError) {
          this.retryAttempt = 0
          console.warn(`[kun] OTLP trace export rejected; dropping batch: ${error.message}`)
          return
        }
        if (this.closed) {
          this.requeue(batch)
          return
        }
        this.requeue(batch)
        const delayMs = this.retryDelayMs(error)
        this.retryAttempt += 1
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] OTLP trace export failed; retrying in ${delayMs}ms: ${message}`)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined
          this.scheduleFlush()
        }, delayMs)
        this.retryTimer.unref?.()
      })
      .finally(() => {
        this.inFlight = undefined
        if (!this.retryTimer && this.queue.length > 0) this.scheduleFlush()
      })
    return this.inFlight
  }

  /**
   * Stop accepting spans and drain every queued batch within one exporter
   * timeout window. Shutdown never leaves retry timers behind and never makes
   * process exit wait through an unbounded retry sequence.
   */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.drainAndClose()
    return this.shutdownPromise
  }

  private scheduleFlush(): void {
    if (this.closed || this.scheduled || this.inFlight || this.retryTimer) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flush()
    })
  }

  private requeue(batch: AgentObservabilitySpan[]): void {
    const available = Math.max(0, this.maxQueueSize - this.queue.length)
    this.queue = [...batch.slice(Math.max(0, batch.length - available)), ...this.queue]
  }

  private retryDelayMs(error: unknown): number {
    if (error instanceof RetryableOtlpExportError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS)
    }
    const exponentialMs = Math.min(1_000 * 2 ** this.retryAttempt, MAX_RETRY_DELAY_MS)
    const jitteredMs = exponentialMs * (0.5 + this.random())
    return Math.max(1, Math.min(Math.round(jitteredMs), MAX_RETRY_DELAY_MS))
  }

  private async drainAndClose(): Promise<void> {
    this.closed = true
    const deadline = Date.now() + this.timeoutMs
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.inFlight) await this.inFlight

    while (this.queue.length > 0) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        console.warn(`[kun] OTLP trace shutdown timed out; dropping ${this.queue.length} queued span(s)`)
        this.queue = []
        return
      }
      const batch = this.queue.splice(0, this.batchSize)
      try {
        await this.exportBatch(batch, remainingMs)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] OTLP trace export failed during shutdown; dropping batch: ${message}`)
      }
    }
  }

  private async exportBatch(batch: AgentObservabilitySpan[], timeoutMs = this.timeoutMs): Promise<void> {
    const controller = new AbortController()
    const effectiveTimeoutMs = Math.max(1, timeoutMs)
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...this.headers
          },
          body: JSON.stringify(toExportTraceServiceRequest(batch)),
          signal: controller.signal
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error(`collector request timed out after ${effectiveTimeoutMs}ms`))
          }, effectiveTimeoutMs)
          timeout.unref?.()
        })
      ])
      if (!response.ok) {
        const message = `collector returned HTTP ${response.status}`
        if (RETRYABLE_HTTP_STATUS_CODES.has(response.status)) {
          throw new RetryableOtlpExportError(
            message,
            parseRetryAfterMs(response.headers.get('retry-after'))
          )
        }
        throw new PermanentOtlpExportError(message)
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, dateMs - Date.now())
}

export function resolveOtlpTracesEndpoint(input: {
  tracesEndpoint?: string
  commonEndpoint?: string
}): string {
  if (input.tracesEndpoint) return input.tracesEndpoint
  if (!input.commonEndpoint) return DEFAULT_OTLP_ENDPOINT
  return input.commonEndpoint.replace(/\/$/, '') + '/v1/traces'
}

export function parseOtlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined
  const headers: Record<string, string> = {}
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = safeDecodeURIComponent(entry.slice(0, separator).trim())
    const headerValue = safeDecodeURIComponent(entry.slice(separator + 1).trim())
    if (key) headers[key] = headerValue
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toExportTraceServiceRequest(spans: AgentObservabilitySpan[]): Record<string, unknown> {
  return {
    resourceSpans: [{
      resource: {
        attributes: [attribute('service.name', 'kun-runtime')]
      },
      scopeSpans: [{
        scope: { name: 'kun.agent-observability' },
        spans: spans.map(toOtlpSpan),
        schemaUrl: spans[0]?.schemaUrl
      }]
    }]
  }
}

function toOtlpSpan(span: AgentObservabilitySpan): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: span.kind === 'client' ? 3 : 1,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: Object.entries(span.attributes).map(([key, value]) => attribute(key, value)),
    status: {
      code: span.status.code === 'OK' ? 1 : span.status.code === 'ERROR' ? 2 : 0,
      ...(span.status.message ? { message: span.status.message } : {})
    },
    ...(span.events?.length
      ? {
          events: span.events.map((event) => ({
            name: event.name,
            timeUnixNano: event.timeUnixNano,
            attributes: Object.entries(event.attributes ?? {}).map(([key, value]) => attribute(key, value))
          }))
        }
      : {})
  }
}

function attribute(key: string, value: AgentObservabilityAttributeValue): Record<string, unknown> {
  return { key, value: anyValue(value) }
}

function anyValue(value: AgentObservabilityAttributeValue): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => ({ stringValue: entry })) } }
  }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  return { stringValue: value }
}
