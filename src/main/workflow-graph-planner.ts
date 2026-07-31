import type { WorkflowConnectionV1, WorkflowNodeV1, WorkflowV1 } from '../shared/app-settings'

export type WorkflowExecutionPlan = {
  triggerNodeId: string
  nodeById: ReadonlyMap<string, WorkflowNodeV1>
  incomingByNodeId: ReadonlyMap<string, readonly WorkflowConnectionV1[]>
  outgoingByNodeId: ReadonlyMap<string, readonly WorkflowConnectionV1[]>
}

export type WorkflowPlanResult =
  | { ok: true; plan: WorkflowExecutionPlan }
  | { ok: false; error: string }

export function selectWorkflowTrigger(workflow: WorkflowV1, enabledOnly = false): WorkflowNodeV1 | null {
  const candidates = enabledOnly ? workflow.nodes.filter((node) => !node.disabled) : workflow.nodes
  return candidates.find((node) => node.type === 'manual-trigger')
    ?? candidates.find((node) => node.type === 'schedule-trigger')
    ?? candidates.find((node) => node.type === 'webhook-trigger')
    ?? null
}

export function createWorkflowExecutionPlan(
  workflow: WorkflowV1,
  triggerNodeId: string
): WorkflowPlanResult {
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]))
  if (!nodeById.has(triggerNodeId)) {
    return { ok: false, error: `Workflow trigger node not found: ${triggerNodeId}` }
  }
  const incomingByNodeId = new Map<string, WorkflowConnectionV1[]>()
  const outgoingByNodeId = new Map<string, WorkflowConnectionV1[]>()
  for (const edge of workflow.connections) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      return { ok: false, error: `Workflow connection references a missing node: ${edge.id}` }
    }
    const outgoing = outgoingByNodeId.get(edge.source) ?? []
    outgoing.push(edge)
    outgoingByNodeId.set(edge.source, outgoing)
    const incoming = incomingByNodeId.get(edge.target) ?? []
    incoming.push(edge)
    incomingByNodeId.set(edge.target, incoming)
  }
  return {
    ok: true,
    plan: { triggerNodeId, nodeById, incomingByNodeId, outgoingByNodeId }
  }
}
