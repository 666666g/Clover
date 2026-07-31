import { describe, expect, it } from 'vitest'
import type { WorkflowV1 } from '../shared/app-settings'
import { createWorkflowExecutionPlan, selectWorkflowTrigger } from './workflow-graph-planner'

function workflow(): WorkflowV1 {
  return {
    id: 'workflow_1',
    name: 'Plan test',
    enabled: true,
    callableByAgent: false,
    nodes: [
      { id: 'trigger', type: 'manual-trigger', name: 'Trigger', position: { x: 0, y: 0 }, disabled: false, config: { inputSchema: [] } },
      { id: 'output', type: 'output', name: 'Output', position: { x: 1, y: 1 }, disabled: false, config: { mode: 'auto', textTemplate: '', jsonPath: '' } }
    ],
    connections: [{ id: 'edge_1', source: 'trigger', target: 'output', sourceHandle: 'out', targetHandle: 'in' }],
    env: [], runs: [], createdAt: '', updatedAt: '', lastRunAt: '', lastStatus: 'idle', lastMessage: '', nextRunAt: ''
  }
}

describe('workflow graph planner', () => {
  it('selects and indexes a deterministic execution plan', () => {
    const subject = workflow()
    expect(selectWorkflowTrigger(subject)?.id).toBe('trigger')
    const result = createWorkflowExecutionPlan(subject, 'trigger')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.outgoingByNodeId.get('trigger')?.map((edge) => edge.id)).toEqual(['edge_1'])
    expect(result.plan.incomingByNodeId.get('output')?.map((edge) => edge.id)).toEqual(['edge_1'])
  })

  it('rejects dangling graph connections before execution', () => {
    const subject = workflow()
    subject.connections[0] = { ...subject.connections[0], target: 'missing' }
    expect(createWorkflowExecutionPlan(subject, 'trigger')).toEqual({
      ok: false,
      error: 'Workflow connection references a missing node: edge_1'
    })
  })
})
