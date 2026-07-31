import type { WorkflowConditionConfigV1 } from '../shared/app-settings'

export type WorkflowPayload = { json: unknown; text: string }

export type InterpScope = {
  input?: Record<string, unknown>
  nodes?: Record<string, WorkflowPayload>
  env?: Record<string, unknown>
  run?: Record<string, unknown>
  loop?: { index: number; item: unknown; total: number }
}

export function safeJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try { return JSON.stringify(value) } catch { return '' }
}

export function getByPath(value: unknown, path: string): unknown {
  const segments = path.trim().replace(/^json\.?/, '').split('.').filter(Boolean)
  let cursor = value
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || !(segment in (cursor as Record<string, unknown>))) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : safeJson(value)
}

export function resolveExpr(payload: WorkflowPayload, expr: string, scope?: InterpScope): unknown {
  const t = expr.trim()
  if (t.startsWith('$nodes.')) {
    const [nodeId, ...rest] = t.slice('$nodes.'.length).split('.')
    const nodePayload = scope?.nodes?.[nodeId]
    if (!nodePayload) return undefined
    const sub = rest.join('.')
    if (!sub || sub === 'json') return nodePayload.json
    if (sub === 'text') return nodePayload.text
    return getByPath(nodePayload.json, sub)
  }
  for (const [prefix, values] of [['$input.', scope?.input], ['$run.', scope?.run]] as const) {
    if (!t.startsWith(prefix)) continue
    const [key, ...rest] = t.slice(prefix.length).split('.')
    const base = values?.[key]
    return rest.length ? getByPath(base, rest.join('.')) : base
  }
  if (t.startsWith('$env.')) return scope?.env?.[t.slice('$env.'.length)]
  if (t === '$loop.index') return scope?.loop?.index
  if (t === '$loop.total') return scope?.loop?.total
  if (t === '$loop.item' || t.startsWith('$loop.item.')) {
    const sub = t === '$loop.item' ? '' : t.slice('$loop.item.'.length)
    return sub ? getByPath(scope?.loop?.item, sub) : scope?.loop?.item
  }
  if (!t || t === 'text') return payload.text
  if (t === 'json') return payload.json
  return getByPath(payload.json, t)
}

export function interpolate(template: string, payload: WorkflowPayload, scope?: InterpScope): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => stringifyValue(resolveExpr(payload, expr, scope)))
}

export function buildAiPrompt(template: string, payload: WorkflowPayload, scope: InterpScope): string {
  const rendered = interpolate(template, payload, scope)
  if (/\{\{\s*[^}]+?\s*\}\}/.test(template)) return rendered
  const inputText = scope.input && Object.keys(scope.input).length
    ? Object.entries(scope.input).map(([key, value]) => `${key}: ${stringifyValue(value)}`).join('\n').trim()
    : ''
  const payloadText = payload.text.trim()
  const context = inputText || (['{}', '[]', 'null'].includes(payloadText) ? '' : payloadText)
    || (payload.json !== null && payload.json !== undefined && typeof payload.json !== 'object'
      ? stringifyValue(payload.json)
      : '')
  if (!context) return rendered
  return rendered.trim() ? `${rendered.trim()}\n\n${context}` : context
}

export function evaluateCondition(
  config: WorkflowConditionConfigV1,
  payload: WorkflowPayload,
  scope?: InterpScope
): boolean {
  const left = stringifyValue(config.leftExpr.trim() ? resolveExpr(payload, config.leftExpr, scope) : payload.text)
  const right = config.rightValue
  const l = config.caseSensitive ? left : left.toLowerCase()
  const r = config.caseSensitive ? right : right.toLowerCase()
  switch (config.operator) {
    case 'contains': return l.includes(r)
    case 'notContains': return !l.includes(r)
    case 'equals': return l === r
    case 'notEquals': return l !== r
    case 'startsWith': return l.startsWith(r)
    case 'endsWith': return l.endsWith(r)
    case 'isEmpty': return left.trim() === ''
    case 'isNotEmpty': return left.trim() !== ''
    case 'gt': return Number(left) > Number(right)
    case 'gte': return Number(left) >= Number(right)
    case 'lt': return Number(left) < Number(right)
    case 'lte': return Number(left) <= Number(right)
    default: return false
  }
}
