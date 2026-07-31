import { describe, expect, it, vi } from 'vitest'
import { WorkflowRunCoordinator } from './workflow-run-coordinator'

describe('WorkflowRunCoordinator', () => {
  it('owns one begin/finish lifecycle and clears live state after linger', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    expect(coordinator.begin('workflow_1', ['node_1'])).toBe(true)
    expect(coordinator.begin('workflow_1', ['node_1'])).toBe(false)
    coordinator.setLive('workflow_1', 'node_1', 'success')
    coordinator.finish('workflow_1', 'run_1', 100)
    expect(coordinator.isRunning('workflow_1')).toBe(false)
    expect(coordinator.status(false).nodeStatus.workflow_1.node_1).toBe('success')
    vi.advanceTimersByTime(100)
    expect(coordinator.status(false).nodeStatus.workflow_1).toBeUndefined()
    vi.useRealTimers()
  })

  it('cancellation settles a pending approval and reaches one decision', async () => {
    const coordinator = new WorkflowRunCoordinator()
    coordinator.begin('workflow_1', ['approval_1'])
    const decision = coordinator.awaitApproval({
      token: 'approval_token',
      workflowId: 'workflow_1',
      runId: 'run_1',
      nodeId: 'approval_1',
      nodeName: 'Approval',
      title: 'Continue?',
      instruction: 'Approve the run',
      createdAt: '2026-07-11T00:00:00.000Z'
    }, 0, 'approved')
    const signal = coordinator.signal('workflow_1')

    expect(signal?.aborted).toBe(false)
    expect(coordinator.requestCancel('workflow_1')).toBe(true)
    expect(signal?.aborted).toBe(true)
    await expect(decision).resolves.toBe('rejected')
    expect(coordinator.resolveApproval('approval_token', 'approved')).toBe(false)
  })
})
