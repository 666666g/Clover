import type { WorkflowNodeV1 } from '../shared/app-settings'
import {
  evaluateCondition,
  getByPath,
  interpolate,
  safeJson,
  stringifyValue,
  type InterpScope,
  type WorkflowPayload
} from './workflow-expression'

export type WorkflowNodeOutcome = {
  payload: WorkflowPayload
  message: string
  branch?: string
  threadId?: string
}

const CORE_NODE_KINDS = new Set<WorkflowNodeV1['type']>([
  'manual-trigger', 'schedule-trigger', 'webhook-trigger', 'condition', 'switch', 'merge',
  'set-fields', 'filter', 'sort', 'limit', 'aggregate', 'delay', 'template', 'json', 'output'
])
export type CoreWorkflowNode = Extract<WorkflowNodeV1, {
  type: 'manual-trigger' | 'schedule-trigger' | 'webhook-trigger' | 'condition' | 'switch' |
    'merge' | 'set-fields' | 'filter' | 'sort' | 'limit' | 'aggregate' | 'delay' | 'template' |
    'json' | 'output'
}>
export function isCoreWorkflowNode(node: WorkflowNodeV1): node is CoreWorkflowNode {
  return CORE_NODE_KINDS.has(node.type)
}

export async function executeCoreWorkflowNode(input: {
  node: CoreWorkflowNode
  payload: WorkflowPayload
  inputs: WorkflowPayload[]
  scope: InterpScope
  runVars: Record<string, unknown>
  sleep: (ms: number) => Promise<void>
}): Promise<WorkflowNodeOutcome | null> {
  const { node, payload, inputs, scope, runVars } = input
  switch (node.type) {
    case 'manual-trigger':
    case 'schedule-trigger':
    case 'webhook-trigger':
      return { payload, message: 'Triggered' }
    case 'condition': {
      const matched = evaluateCondition(node.config, payload, scope)
      return { payload, message: matched ? 'true' : 'false', branch: matched ? 'true' : 'false' }
    }
    case 'switch': {
      const index = node.config.rules.findIndex((rule) => evaluateCondition(rule, payload, scope))
      if (index >= 0) return { payload, message: `case ${index + 1}`, branch: `case-${index}` }
      return { payload, message: node.config.fallback ? 'fallback' : 'no match', branch: node.config.fallback ? 'fallback' : '__none__' }
    }
    case 'merge': {
      if (node.config.mode === 'object') {
        const merged: Record<string, unknown> = {}
        for (const item of inputs) {
          if (item.json && typeof item.json === 'object' && !Array.isArray(item.json)) Object.assign(merged, item.json)
        }
        return { payload: { json: merged, text: safeJson(merged) }, message: `merged ${inputs.length}` }
      }
      return {
        payload: { json: inputs.map((item) => item.json), text: inputs.map((item) => item.text).filter(Boolean).join('\n') },
        message: `merged ${inputs.length}`
      }
    }
    case 'set-fields': {
      if (node.config.scope === 'run') {
        for (const field of node.config.fields) if (field.key.trim()) runVars[field.key.trim()] = interpolate(field.value, payload, scope)
        return { payload, message: `set ${node.config.fields.length} run var(s)` }
      }
      const json = node.config.keepIncoming && payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
        ? { ...(payload.json as Record<string, unknown>) }
        : {}
      for (const field of node.config.fields) if (field.key.trim()) json[field.key.trim()] = interpolate(field.value, payload, scope)
      return { payload: { json, text: safeJson(json) }, message: `${node.config.fields.length} fields` }
    }
    case 'filter': {
      const pass = evaluateCondition(node.config, payload, scope)
      return { payload, message: pass ? 'pass' : 'blocked', branch: pass ? undefined : '__none__' }
    }
    case 'sort': {
      const items = Array.isArray(payload.json) ? [...payload.json] : []
      items.sort((a, b) => {
        const av = node.config.field ? getByPath(a, node.config.field) : a
        const bv = node.config.field ? getByPath(b, node.config.field) : b
        const cmp = node.config.numeric ? (Number(av) || 0) - (Number(bv) || 0) : String(av ?? '').localeCompare(String(bv ?? ''))
        return node.config.order === 'desc' ? -cmp : cmp
      })
      return { payload: { json: items, text: safeJson(items) }, message: `sorted ${items.length}` }
    }
    case 'limit': {
      const items = Array.isArray(payload.json) ? payload.json : []
      const out = node.config.from === 'last' ? items.slice(-node.config.count) : items.slice(0, node.config.count)
      return { payload: { json: out, text: safeJson(out) }, message: `${out.length} items` }
    }
    case 'aggregate': {
      const items = Array.isArray(payload.json) ? payload.json : []
      const valueOf = (item: unknown): unknown => node.config.field ? getByPath(item, node.config.field) : item
      if (node.config.mode === 'sum') {
        const sum = items.reduce<number>((total, item) => total + (Number(valueOf(item)) || 0), 0)
        return { payload: { json: { sum }, text: safeJson({ sum }) }, message: `sum ${sum}` }
      }
      if (node.config.mode === 'join') {
        const text = items.map((item) => stringifyValue(valueOf(item))).join(node.config.separator || ', ')
        return { payload: { json: { text }, text }, message: `joined ${items.length}` }
      }
      if (node.config.mode === 'collect') {
        const values = items.map(valueOf)
        return { payload: { json: { values }, text: safeJson({ values }) }, message: `collected ${values.length}` }
      }
      return { payload: { json: { count: items.length }, text: safeJson({ count: items.length }) }, message: `count ${items.length}` }
    }
    case 'delay':
      await input.sleep(node.config.delayMs)
      return { payload, message: `Waited ${node.config.delayMs}ms` }
    case 'template': {
      const rendered = interpolate(node.config.template, payload, scope)
      if (node.config.outputMode !== 'json') return { payload: { json: { text: rendered }, text: rendered }, message: 'formatted' }
      try { return { payload: { json: JSON.parse(rendered), text: rendered }, message: 'formatted' } }
      catch { return { payload: { json: { text: rendered }, text: rendered }, message: 'formatted (text fallback)' } }
    }
    case 'json': {
      if (node.config.mode === 'stringify') {
        const text = safeJson(payload.json)
        return { payload: { json: { text }, text }, message: 'stringified' }
      }
      try { return { payload: { json: JSON.parse(payload.text), text: payload.text }, message: 'parsed' } }
      catch (error) {
        if (node.config.strict) throw new Error(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
        return { payload: { json: { text: payload.text }, text: payload.text }, message: 'parse fallback' }
      }
    }
    case 'output': {
      if (node.config.mode === 'text') {
        const text = interpolate(node.config.textTemplate, payload, scope)
        return { payload: { json: { text }, text }, message: 'output' }
      }
      if (node.config.mode === 'json') {
        const value = (node.config.jsonPath.trim() ? getByPath(payload.json, node.config.jsonPath) : payload.json) ?? null
        return { payload: { json: value, text: safeJson(value) }, message: 'output' }
      }
      return { payload, message: 'output' }
    }
    default:
      return null
  }
}
