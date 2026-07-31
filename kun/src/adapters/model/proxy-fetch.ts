import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { ProxyAgent } from 'proxy-agent'

export function createProxyFetch(proxyUrl: string): typeof fetch | null {
  const normalizedProxyUrl = proxyUrl.trim()
  if (!normalizedProxyUrl) return null
  return (input, init) => fetchViaProxy(input, init, normalizedProxyUrl)
}

async function fetchViaProxy(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  proxyUrl: string
): Promise<Response> {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported proxied request protocol: ${url.protocol}`)
  }

  const body = await requestBodyToBuffer(init?.body)
  const headers = headersToRecord(init?.headers)
  if (body && !hasHeader(headers, 'content-length')) {
    headers['content-length'] = String(body.byteLength)
  }

  return new Promise<Response>((resolve, reject) => {
    const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl })
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: init?.method ?? 'GET',
        headers,
        agent
      },
      (response) => {
        if (settled) {
          response.resume()
          return
        }
        settled = true
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(key, item)
          } else if (value !== undefined) {
            responseHeaders.set(key, String(value))
          }
        }
        const webBody = Readable.toWeb(response) as ReadableStream<Uint8Array>
        resolve(new Response(webBody, {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: responseHeaders
        }))
      }
    )

    const signal = init?.signal
    let settled = false
    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const abort = (): void => {
      request.destroy(new Error('The operation was aborted.'))
    }
    request.on('error', settleReject)
    request.on('close', () => signal?.removeEventListener('abort', abort))
    if (signal?.aborted) {
      abort()
      settleReject(new Error('The operation was aborted.'))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (body) request.write(body)
    request.end()
  })
}

async function requestBodyToBuffer(body: RequestInit['body'] | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) return null
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  throw new Error('Unsupported proxied request body type.')
}

function headersToRecord(headers: RequestInit['headers'] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const normalized = new Headers(headers)
  normalized.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized)
}
