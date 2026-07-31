import type {
  AppSettingsV1,
  WorkflowConnectionV1,
  WorkflowEnvVarV1,
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowRunStatus,
  WorkflowV1
} from '../shared/app-settings'
import { createWorkflowExecutionPlan } from './workflow-graph-planner'
import {
  interpolate,
  resolveExpr,
  safeJson,
  type InterpScope,
  type WorkflowPayload
} from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'
import { sleep } from './schedule-runtime-helpers'
import {
  collectWorkflowSecretValues,
  redactWorkflowSecrets
} from './workflow-secret-redaction'

const MAX_NODE_EXECUTIONS = 200
const MAX_RUN_DURATION_MS = 30 * 60_000

export type WorkflowGraphRunResult = {
  status: WorkflowRunStatus
  errorMessage: string
  nodeResults: WorkflowNodeRunResultV1[]
  output: WorkflowPayload
}

export type WorkflowGraphExecutionContext = {
  settings: AppSettingsV1
  signal?: AbortSignal
  statusWorkflowId?: string
  cancelId?: string
  runId?: string
  depth: number
  workspaceOverride?: string
  loop?: { index: number; item: unknown; total: number }
  runVars?: Record<string, unknown>
}

export type WorkflowNodeExecutionRequest = {
  node: WorkflowNodeV1
  payload: WorkflowPayload
  settings: AppSettingsV1
  inputs: WorkflowPayload[]
  depth: number
  runWorkspace: string
  scope: InterpScope
  runVars: Record<string, unknown>
  runRef?: { workflowId: string; runId: string }
  cancelId?: string
  statusWorkflowId?: string
  signal?: AbortSignal
}

export async function executeWorkflowGraph(input: {
  workflow: WorkflowV1
  triggerNodeId: string
  initialPayload: WorkflowPayload
  context: WorkflowGraphExecutionContext
  executeNode: (request: WorkflowNodeExecutionRequest) => Promise<WorkflowNodeOutcome>
  setLive: (nodeId: string, status: WorkflowNodeRunStatus) => void
  setLiveResult: (result: WorkflowNodeRunResultV1) => void
  isCanceled: () => boolean
  logError: (message: string, details: Record<string, unknown>) => void
  nowMs?: () => number
  nowIso?: () => string
}): Promise<WorkflowGraphRunResult> {
  const { context, initialPayload, triggerNodeId, workflow } = input
  const { settings } = context
  const nowMs = input.nowMs ?? Date.now
  const nowIso = input.nowIso ?? (() => new Date().toISOString())
  const env = resolveWorkflowEnv(workflow.env)
  const runVars = context.runVars ?? {}
  const runWorkspace = context.workspaceOverride?.trim() || resolveWorkflowRunWorkspace(
    workflow,
    settings,
    triggerNodeId,
    initialPayload,
    { env, run: runVars, loop: context.loop }
  )

  const planned = createWorkflowExecutionPlan(workflow, triggerNodeId)
  if (!planned.ok) {
    return { status: 'error', errorMessage: planned.error, nodeResults: [], output: initialPayload }
  }
  const nodeById = planned.plan.nodeById
  const outEdges = planned.plan.outgoingByNodeId
  const inEdges = planned.plan.incomingByNodeId
  const nodeResults: WorkflowNodeRunResultV1[] = []
  const delivered = new Set<string>()
  const prunedEdges = new Set<string>()
  const payloadByEdge = new Map<string, WorkflowPayload>()
  const settledNodes = new Set<string>()
  const readyQueue: string[] = []
  const deadline = nowMs() + MAX_RUN_DURATION_MS
  let executions = 0
  let status: WorkflowRunStatus = 'success'
  let errorMessage = ''
  let output = initialPayload

  const nodeOutputs: Record<string, WorkflowPayload> = {}
  const secretValues = collectWorkflowSecretValues(settings)
  const redact = (text: string): string => redactWorkflowSecrets(secretValues, text)
  const scopeFor = (): InterpScope => ({ nodes: nodeOutputs, env, run: runVars, loop: context.loop })
  const incoming = (nodeId: string): readonly WorkflowConnectionV1[] => inEdges.get(nodeId) ?? []
  const edgeResolved = (edge: WorkflowConnectionV1): boolean => delivered.has(edge.id) || prunedEdges.has(edge.id)
  const allResolved = (nodeId: string): boolean => incoming(nodeId).every(edgeResolved)
  const hasLiveInput = (nodeId: string): boolean => incoming(nodeId).some((edge) => delivered.has(edge.id))
  const markReady = (nodeId: string): void => {
    if (!settledNodes.has(nodeId) && !readyQueue.includes(nodeId)) readyQueue.push(nodeId)
  }
  function pruneEdge(edge: WorkflowConnectionV1): void {
    if (delivered.has(edge.id) || prunedEdges.has(edge.id)) return
    prunedEdges.add(edge.id)
    settleTarget(edge.target)
  }
  function pruneNode(nodeId: string): void {
    if (settledNodes.has(nodeId)) return
    settledNodes.add(nodeId)
    for (const edge of outEdges.get(nodeId) ?? []) pruneEdge(edge)
  }
  function settleTarget(nodeId: string): void {
    if (settledNodes.has(nodeId) || !allResolved(nodeId)) return
    if (hasLiveInput(nodeId)) markReady(nodeId)
    else pruneNode(nodeId)
  }
  const handleActive = (outcome: WorkflowNodeOutcome | null, sourceHandle: string): boolean =>
    !outcome || outcome.branch === undefined || sourceHandle === outcome.branch

  markReady(triggerNodeId)
  try {
    while (readyQueue.length > 0) {
      if (input.isCanceled() || context.signal?.aborted) {
        status = 'error'
        errorMessage = 'Canceled.'
        break
      }
      if (nowMs() > deadline) {
        status = 'error'
        errorMessage = 'Workflow exceeded the maximum run duration.'
        break
      }
      if (executions >= MAX_NODE_EXECUTIONS) {
        status = 'error'
        errorMessage = 'Workflow exceeded the maximum node count.'
        break
      }
      const nodeId = readyQueue.shift()
      if (!nodeId || settledNodes.has(nodeId)) continue
      const node = nodeById.get(nodeId)
      settledNodes.add(nodeId)
      if (!node) continue
      executions += 1

      const inputs = incoming(nodeId)
        .filter((edge) => delivered.has(edge.id))
        .map((edge) => payloadByEdge.get(edge.id))
        .filter((value): value is WorkflowPayload => Boolean(value))
      const primary = inputs[0] ?? (nodeId === triggerNodeId ? initialPayload : { json: {}, text: '' })

      let outcome: WorkflowNodeOutcome | null
      if (node.disabled) {
        input.setLive(node.id, 'skipped')
        outcome = null
      } else {
        input.setLive(node.id, 'running')
        const startedAt = nowIso()
        const inputJson = redact(safeJson(primary.json))
        input.setLiveResult({
          nodeId: node.id,
          status: 'running',
          startedAt,
          finishedAt: '',
          message: '',
          outputJson: '',
          inputJson,
          retries: 0,
          threadId: '',
          error: ''
        })
        const maxRetries = node.retries ?? 0
        let attempt = 0
        let produced: WorkflowNodeOutcome | null = null
        let lastError = ''
        while (true) {
          try {
            const baseScope = scopeFor()
            const nodeInputs = resolveNodeInputs(node, primary, baseScope)
            produced = await input.executeNode({
              node,
              payload: primary,
              settings,
              inputs: inputs.length ? inputs : [primary],
              depth: context.depth,
              runWorkspace,
              scope: nodeInputs ? { ...baseScope, input: nodeInputs } : baseScope,
              runVars,
              ...(context.cancelId ? { cancelId: context.cancelId } : {}),
              ...(context.statusWorkflowId ? { statusWorkflowId: context.statusWorkflowId } : {}),
              ...(context.signal ? { signal: context.signal } : {}),
              runRef: context.statusWorkflowId && context.runId
                ? { workflowId: context.statusWorkflowId, runId: context.runId }
                : undefined
            })
            if (input.isCanceled() || context.signal?.aborted) {
              throw new Error('Canceled.')
            }
            break
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error)
            if (input.isCanceled() || context.signal?.aborted) {
              lastError = 'Canceled.'
              break
            }
            if (attempt < maxRetries) {
              attempt += 1
              if (node.retryDelayMs) await sleep(node.retryDelayMs, context.signal)
              continue
            }
            const mode = node.onError ?? 'fail'
            if (mode === 'continue' || mode === 'fallback') {
              let fallback: unknown = null
              if (mode === 'fallback' && node.fallbackJson) {
                try {
                  fallback = JSON.parse(node.fallbackJson)
                } catch {
                  fallback = node.fallbackJson
                }
              }
              produced = {
                payload: { json: fallback, text: mode === 'fallback' ? safeJson(fallback) : '' },
                message: `error handled (${mode}): ${lastError}`
              }
            }
            break
          }
        }
        if (produced) {
          const result: WorkflowNodeRunResultV1 = {
            nodeId: node.id,
            status: 'success',
            startedAt,
            finishedAt: nowIso(),
            message: redact(produced.message),
            outputJson: redact(safeJson(produced.payload.json)),
            inputJson,
            retries: attempt,
            threadId: produced.threadId ?? '',
            error: lastError ? redact(lastError) : ''
          }
          nodeResults.push(result)
          input.setLiveResult(result)
          input.setLive(node.id, 'success')
          outcome = produced
          output = produced.payload
          nodeOutputs[node.id] = produced.payload
        } else {
          const result: WorkflowNodeRunResultV1 = {
            nodeId: node.id,
            status: 'error',
            startedAt,
            finishedAt: nowIso(),
            message: '',
            outputJson: '',
            inputJson,
            retries: attempt,
            threadId: '',
            error: redact(lastError)
          }
          nodeResults.push(result)
          input.setLiveResult(result)
          input.setLive(node.id, 'error')
          status = 'error'
          errorMessage = redact(lastError)
          break
        }
      }

      const outPayload = outcome ? outcome.payload : primary
      const edges = outEdges.get(node.id) ?? []
      for (const edge of edges) {
        if (handleActive(outcome, edge.sourceHandle || 'out')) {
          delivered.add(edge.id)
          payloadByEdge.set(edge.id, outPayload)
        } else {
          prunedEdges.add(edge.id)
        }
      }
      for (const edge of edges) settleTarget(edge.target)
    }
  } catch (error) {
    status = 'error'
    errorMessage = redact(error instanceof Error ? error.message : String(error))
    input.logError('Workflow graph failed', { message: errorMessage, workflowId: workflow.id })
  }
  return { status, errorMessage, nodeResults, output }
}

function coerceNodeInputValue(type: 'text' | 'number' | 'boolean' | 'json', raw: unknown): unknown {
  switch (type) {
    case 'number': {
      const number = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
      return Number.isFinite(number) ? number : 0
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1'
    case 'json':
      if (raw && typeof raw === 'object') return raw
      try {
        return JSON.parse(String(raw ?? ''))
      } catch {
        return raw ?? null
      }
    default:
      return typeof raw === 'string' ? raw : raw == null ? '' : safeJson(raw)
  }
}

function resolveNodeInputs(
  node: WorkflowNodeV1,
  payload: WorkflowPayload,
  scope: InterpScope
): Record<string, unknown> | undefined {
  const bindings = node.inputs
  if (!bindings || bindings.length === 0) return undefined
  const output: Record<string, unknown> = {}
  for (const binding of bindings) {
    const key = binding.key.trim()
    if (!key) continue
    const single = binding.source.trim().match(/^\{\{([^}]+)\}\}$/)
    const raw = single ? resolveExpr(payload, single[1], scope) : interpolate(binding.source, payload, scope)
    output[key] = coerceNodeInputValue(binding.type, raw)
  }
  return output
}

export function resolveWorkflowEnv(env: WorkflowEnvVarV1[]): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const entry of env) {
    if (!entry.key) continue
    output[entry.key] = entry.type === 'number'
      ? Number(entry.value) || 0
      : entry.type === 'boolean'
        ? entry.value === 'true'
        : entry.value
  }
  return output
}

export function resolveWorkflowRunWorkspace(
  workflow: WorkflowV1,
  settings: AppSettingsV1,
  triggerNodeId?: string,
  payload?: WorkflowPayload,
  scope?: InterpScope
): string {
  const triggers = workflow.nodes.filter((node) =>
    node.type === 'manual-trigger' || node.type === 'schedule-trigger' || node.type === 'webhook-trigger')
  const trigger = (triggerNodeId ? triggers.find((node) => node.id === triggerNodeId) : undefined) ?? triggers[0]
  const rawWorkspace = trigger && typeof (trigger.config as { workspaceRoot?: unknown }).workspaceRoot === 'string'
    ? (trigger.config as { workspaceRoot: string }).workspaceRoot
    : ''
  const triggerWorkspace = (payload ? interpolate(rawWorkspace, payload, scope) : rawWorkspace).trim()
  return triggerWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot
}
