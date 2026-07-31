import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'

export function decodeAnthropicMessagesStreamPayload(input: {
  payload: Record<string, unknown>
  pendingArguments: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  completedToolCalls: Set<string>
  sawTextDelta: boolean
  budget: ModelStreamResourceBudget
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
}): {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
} {
  const chunks: ModelStreamChunk[] = []
  let sawText = input.sawTextDelta
  let finishReason: string | null = null
  let usage: UsageSnapshot | null = null
  const type = recordString(input.payload, 'type')
  const index = numericIndex(input.payload.index)
  if (type === 'message_start') {
    const message = recordValue(input.payload, 'message')
    const usagePayload = message ? recordValue(message, 'usage') : null
    if (usagePayload) usage = input.normalizeUsage(usagePayload)
  } else if (type === 'content_block_start') {
    const block = recordValue(input.payload, 'content_block')
    if (block && recordString(block, 'type') === 'tool_use') {
      const callId = recordString(block, 'id') || indexFallbackCallId(index, input.pendingArguments)
      const pending = input.budget.pendingCall(input.pendingArguments, callId, index)
      if (index !== undefined) input.budget.bindPendingIndex(input.pendingByIndex, index, callId)
      const name = recordString(block, 'name')
      if (name) pending.name = name
      const initial = recordValue(block, 'input')
      if (initial && Object.keys(initial).length) {
        input.budget.replaceArguments(pending, JSON.stringify(initial))
      }
    }
  } else if (type === 'content_block_delta') {
    const delta = recordValue(input.payload, 'delta')
    const deltaType = delta ? recordString(delta, 'type') : ''
    if (deltaType === 'text_delta') {
      const text = recordString(delta!, 'text')
      if (text) {
        sawText = true
        chunks.push({ kind: 'assistant_text_delta', text })
      }
    } else if (deltaType === 'thinking_delta') {
      const text = recordString(delta!, 'thinking')
      if (text) chunks.push({ kind: 'assistant_reasoning_delta', text })
    } else if (deltaType === 'input_json_delta') {
      const callId = anthropicStreamCallId(index, input.pendingArguments, input.pendingByIndex)
      const pending = input.budget.pendingCall(input.pendingArguments, callId, index)
      const value = recordString(delta!, 'partial_json')
      if (index !== undefined) input.budget.bindPendingIndex(input.pendingByIndex, index, callId)
      if (value) {
        input.budget.appendArguments(pending, value)
        chunks.push({ kind: 'tool_call_delta', callId, toolName: pending.name, argumentsDelta: value })
      }
    }
  } else if (type === 'content_block_stop') {
    const callId = index === undefined ? undefined : input.pendingByIndex.get(index)
    const pending = callId ? input.pendingArguments.get(callId) : undefined
    if (callId && pending?.name) {
      const raw = input.budget.pendingArguments(pending)
      input.budget.completeToolCall(raw)
      chunks.push({
        kind: 'tool_call_complete', callId, toolName: pending.name,
        arguments: input.parseToolArguments(raw || '{}')
      })
      input.completedToolCalls.add(callId)
      input.budget.removePendingCall(input.pendingArguments, callId)
      if (index !== undefined) input.pendingByIndex.delete(index)
    }
  } else if (type === 'message_delta') {
    const delta = recordValue(input.payload, 'delta')
    const stopReason = delta ? anthropicStopReason(recordString(delta, 'stop_reason')) : null
    if (stopReason) finishReason = stopReason
    const usagePayload = recordValue(input.payload, 'usage')
    if (usagePayload) usage = input.normalizeUsage(usagePayload)
  } else if (type === 'message_stop') {
    // `message_delta` carries the semantic reason. The outer stream merger
    // preserves it when this generic terminal frame arrives.
    finishReason = 'stop'
  } else if (type === 'error') {
    chunks.push({ kind: 'error', message: responseErrorMessage(input.payload), code: 'messages_stream_error' })
    finishReason = 'error'
  }
  return { chunks, sawTextDelta: sawText, finishReason, usage }
}

function anthropicStreamCallId(
  index: number | undefined,
  pending: Map<string, PendingToolCall>,
  byIndex: Map<number, string>
): string {
  if (index !== undefined) return byIndex.get(index) ?? indexFallbackCallId(index, pending)
  if (pending.size === 1) return [...pending.keys()][0]
  return indexFallbackCallId(undefined, pending)
}

function anthropicStopReason(value: string): 'stop' | 'tool_calls' | 'length' | 'error' | null {
  if (value === 'tool_use') return 'tool_calls'
  if (value === 'max_tokens') return 'length'
  if (value === 'end_turn' || value === 'stop_sequence' || value === 'pause_turn') return 'stop'
  if (value === 'refusal') return 'error'
  return null
}

function responseErrorMessage(payload: Record<string, unknown>): string {
  const error = recordValue(payload, 'error')
  return (error ? recordString(error, 'message') : '') || recordString(payload, 'message') ||
    'model stream reported an error'
}

function indexFallbackCallId(index: number | undefined, pending: Map<string, PendingToolCall>): string {
  return index === undefined ? `call_${pending.size + 1}` : `call_${index + 1}`
}

function recordString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numericIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
