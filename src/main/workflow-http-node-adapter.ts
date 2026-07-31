import { URL } from 'node:url'
import type { WorkflowHttpRequestConfigV1 } from '../shared/app-settings'
import { interpolate, type InterpScope, type WorkflowPayload } from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'

const HTTP_MAX_RESPONSE_BYTES = 5_000_000

async function readBodyCapped(response: Response): Promise<string> {
  if (!response.body) return response.text()
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.length
    if (size > HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('Response body exceeds the 5MB limit.')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function executeHttpWorkflowNode(
  config: WorkflowHttpRequestConfigV1,
  payload: WorkflowPayload,
  scope?: InterpScope,
  signal?: AbortSignal
): Promise<WorkflowNodeOutcome> {
  const url = interpolate(config.url, payload, scope).trim()
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error(`Invalid URL: ${url || '(empty)'}`) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.')
  const headers: Record<string, string> = {}
  for (const header of config.headers) if (header.key.trim()) headers[header.key.trim()] = interpolate(header.value, payload, scope)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const init: RequestInit = { method: config.method, headers, signal: requestSignal }
    if (config.method !== 'GET' && config.method !== 'DELETE' && config.body.trim()) init.body = interpolate(config.body, payload, scope)
    const response = await fetch(url, init)
    const raw = await readBodyCapped(response)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`)
    let json: unknown = { status: response.status, body: raw }
    if (config.parseJson) {
      try { json = JSON.parse(raw) } catch { json = { status: response.status, body: raw } }
    }
    return { payload: { json, text: raw }, message: `${response.status} ${response.statusText}`.trim() }
  } catch (error) {
    if (signal?.aborted) throw new Error('Workflow canceled.')
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timed out after ${config.timeoutMs}ms.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
