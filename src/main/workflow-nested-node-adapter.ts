import type {
  AppSettingsV1,
  WorkflowNodeV1,
  WorkflowV1
} from '../shared/app-settings'
import {
  evaluateCondition,
  resolveExpr,
  safeJson,
  type InterpScope,
  type WorkflowPayload
} from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'
import type { WorkflowGraphRunResult } from './workflow-graph-executor'

type NestedNode = Extract<WorkflowNodeV1, { type: 'subworkflow' | 'loop' }>

export type RunNestedWorkflowGraph = (
  workflow: WorkflowV1,
  triggerNodeId: string,
  payload: WorkflowPayload,
  context: {
    settings: AppSettingsV1
    depth: number
    signal?: AbortSignal
    cancelId?: string
    statusWorkflowId?: string
    runId?: string
    loop?: { index: number; item: unknown; total: number }
  }
) => Promise<WorkflowGraphRunResult>

const MAX_SUBWORKFLOW_DEPTH = 5

export async function executeNestedWorkflowNode(input: {
  node: NestedNode
  payload: WorkflowPayload
  settings: AppSettingsV1
  depth: number
  scope: InterpScope
  signal?: AbortSignal
  cancelId?: string
  statusWorkflowId?: string
  runId?: string
  runGraph: RunNestedWorkflowGraph
}): Promise<WorkflowNodeOutcome> {
  const { cancelId, depth, node, payload, runGraph, runId, scope, settings, signal, statusWorkflowId } = input
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(node.type === 'subworkflow'
      ? 'Sub-workflow nesting is too deep.'
      : 'Loop nesting is too deep.')
  }
  const target = settings.workflow.workflows.find((workflow) => workflow.id === node.config.workflowId)
  if (!target) {
    throw new Error(node.type === 'subworkflow' ? 'Sub-workflow not found.' : 'Loop body workflow not found.')
  }
  const trigger =
    target.nodes.find((item) => item.type === 'manual-trigger') ??
    target.nodes.find((item) => item.type === 'schedule-trigger') ??
    (node.type === 'loop' ? target.nodes.find((item) => item.type === 'webhook-trigger') : undefined)
  if (!trigger) {
    throw new Error(node.type === 'subworkflow' ? 'Sub-workflow has no trigger node.' : 'Loop body has no trigger node.')
  }
  if (node.type === 'subworkflow') {
    const result = await runGraph(target, trigger.id, payload, {
      settings,
      depth: depth + 1,
      ...(signal ? { signal } : {}),
      ...(cancelId ? { cancelId } : {}),
      ...(statusWorkflowId ? { statusWorkflowId } : {}),
      ...(runId ? { runId } : {})
    })
    if (result.status === 'error') throw new Error(result.errorMessage || 'Sub-workflow failed.')
    return { payload: result.output, message: `ran ${target.name || 'sub-workflow'}` }
  }
  return node.config.mode === 'foreach'
    ? executeForEachLoop({
        node, payload, settings, depth, target, triggerId: trigger.id, scope, runGraph,
        ...(signal ? { signal } : {}),
        ...(cancelId ? { cancelId } : {}),
        ...(statusWorkflowId ? { statusWorkflowId } : {}),
        ...(runId ? { runId } : {})
      })
    : executeUntilLoop({
        node, payload, settings, depth, target, triggerId: trigger.id, scope, runGraph,
        ...(signal ? { signal } : {}),
        ...(cancelId ? { cancelId } : {}),
        ...(statusWorkflowId ? { statusWorkflowId } : {}),
        ...(runId ? { runId } : {})
      })
}

async function executeForEachLoop(input: {
  node: Extract<NestedNode, { type: 'loop' }>
  payload: WorkflowPayload
  settings: AppSettingsV1
  depth: number
  target: WorkflowV1
  triggerId: string
  scope: InterpScope
  runGraph: RunNestedWorkflowGraph
  signal?: AbortSignal
  cancelId?: string
  statusWorkflowId?: string
  runId?: string
}): Promise<WorkflowNodeOutcome> {
  const {
    cancelId, depth, node, payload, runGraph, runId, scope, settings, signal,
    statusWorkflowId, target, triggerId
  } = input
  const source = node.config.arraySource?.trim()
  const raw = source ? resolveExpr(payload, source, scope) : payload.json
  const items = (Array.isArray(raw) ? raw : []).slice(0, node.config.maxIterations)
  const total = items.length
  let aborted = false
  const runItem = async (item: unknown, index: number): Promise<unknown> => {
    if (aborted) throw new Error('Loop aborted after an earlier item failed.')
    const itemPayload: WorkflowPayload = {
      json: item,
      text: typeof item === 'string' ? item : safeJson(item)
    }
    try {
      const result = await runGraph(target, triggerId, itemPayload, {
        settings,
        depth: depth + 1,
        ...(signal ? { signal } : {}),
        ...(cancelId ? { cancelId } : {}),
        ...(statusWorkflowId ? { statusWorkflowId } : {}),
        ...(runId ? { runId } : {}),
        loop: { index, item, total }
      })
      if (result.status === 'error') throw new Error(result.errorMessage || 'Loop item failed.')
      return result.output.json
    } catch (error) {
      if (node.config.continueOnError) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
      aborted = true
      throw error
    }
  }
  const outputs = node.config.execution === 'parallel'
    ? await mapWithConcurrency(items, node.config.concurrency ?? 4, runItem)
    : await mapSequentially(items, runItem)
  const failures = outputs.filter(
    (value) => value && typeof value === 'object' && 'error' in (value as Record<string, unknown>)
  ).length
  return {
    payload: { json: outputs, text: safeJson(outputs) },
    message: `foreach ${total - failures}/${total}${node.config.execution === 'parallel' ? ' (parallel)' : ''}`
  }
}

async function executeUntilLoop(input: {
  node: Extract<NestedNode, { type: 'loop' }>
  payload: WorkflowPayload
  settings: AppSettingsV1
  depth: number
  target: WorkflowV1
  triggerId: string
  scope: InterpScope
  runGraph: RunNestedWorkflowGraph
  signal?: AbortSignal
  cancelId?: string
  statusWorkflowId?: string
  runId?: string
}): Promise<WorkflowNodeOutcome> {
  const {
    cancelId, depth, node, runGraph, runId, scope, settings, signal,
    statusWorkflowId, target, triggerId
  } = input
  const stopCondition = {
    leftExpr: node.config.leftExpr,
    operator: node.config.operator,
    rightValue: node.config.rightValue,
    caseSensitive: node.config.caseSensitive
  }
  let current = input.payload
  let iterations = 0
  let done = false
  while (iterations < node.config.maxIterations) {
    const result = await runGraph(target, triggerId, current, {
      settings,
      depth: depth + 1,
      ...(signal ? { signal } : {}),
      ...(cancelId ? { cancelId } : {}),
      ...(statusWorkflowId ? { statusWorkflowId } : {}),
      ...(runId ? { runId } : {}),
      loop: { index: iterations, item: current.json, total: node.config.maxIterations }
    })
    iterations += 1
    if (result.status === 'error') throw new Error(result.errorMessage || 'Loop body failed.')
    current = result.output
    if (evaluateCondition(stopCondition, current, scope)) {
      done = true
      break
    }
  }
  const baseJson = current.json && typeof current.json === 'object' && !Array.isArray(current.json)
    ? { ...(current.json as Record<string, unknown>) }
    : { value: current.json }
  return {
    payload: { json: { ...baseJson, _iterations: iterations, _done: done }, text: current.text },
    message: `looped ${iterations}${done ? ' (done)' : ' (max)'}`
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function mapSequentially<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += 1) {
    results.push(await fn(items[index], index))
  }
  return results
}
