import { randomUUID } from 'node:crypto'
import type {
  AppSettingsV1,
  WorkflowApprovalDecision,
  WorkflowNodeV1,
  WorkflowPendingApprovalV1
} from '../shared/app-settings'
import { interpolate, type InterpScope, type WorkflowPayload } from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'
import {
  collectWorkflowSecretValues,
  redactWorkflowSecrets
} from './workflow-secret-redaction'

type ApprovalNode = Extract<WorkflowNodeV1, { type: 'human-approval' }>

export async function executeApprovalWorkflowNode(input: {
  node: ApprovalNode
  payload: WorkflowPayload
  settings: AppSettingsV1
  scope: InterpScope
  runRef?: { workflowId: string; runId: string }
  awaitApproval: (
    entry: WorkflowPendingApprovalV1,
    timeoutMs: number,
    onTimeout: WorkflowApprovalDecision
  ) => Promise<WorkflowApprovalDecision>
  createId?: () => string
  nowIso?: () => string
}): Promise<WorkflowNodeOutcome> {
  const { node, payload, runRef, scope, settings } = input
  // A single-node test has no persisted run that can own a pause.
  if (!runRef) return { payload, message: 'approved (test)', branch: 'approved' }

  const secrets = collectWorkflowSecretValues(settings)
  const redact = (text: string): string => redactWorkflowSecrets(secrets, text)
  const entry: WorkflowPendingApprovalV1 = {
    token: input.createId?.() ?? randomUUID(),
    workflowId: runRef.workflowId,
    runId: runRef.runId,
    nodeId: node.id,
    nodeName: node.name,
    title: redact(node.config.title.trim() || node.name.trim() || 'Approval required'),
    instruction: redact(interpolate(node.config.instruction, payload, scope)),
    createdAt: input.nowIso?.() ?? new Date().toISOString()
  }
  const decision = await input.awaitApproval(entry, node.config.timeoutMs, node.config.onTimeout)
  if (decision === 'rejected') return { payload, message: 'rejected', branch: 'rejected' }
  const approvedJson = payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
    ? { ...(payload.json as Record<string, unknown>), _approved: true }
    : payload.json
  return {
    payload: { json: approvedJson, text: payload.text },
    message: 'approved',
    branch: 'approved'
  }
}
