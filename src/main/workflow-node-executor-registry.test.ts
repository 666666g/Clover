import { describe, expect, it } from 'vitest'
import type { WorkflowNodeV1 } from '../shared/app-settings'
import { createWorkflowNodeExecutorRegistry } from './workflow-node-executor-registry'

describe('workflow node executor registry', () => {
  it('registers every persisted workflow node kind exactly once', () => {
    const registry = createWorkflowNodeExecutorRegistry<string>()
    const expected: WorkflowNodeV1['type'][] = [
      'manual-trigger', 'schedule-trigger', 'webhook-trigger', 'ai-agent', 'generate-image',
      'parameter-extractor', 'question-classifier', 'condition', 'switch', 'filter', 'merge',
      'subworkflow', 'loop', 'human-approval', 'set-fields', 'sort', 'limit', 'aggregate',
      'template', 'json', 'output', 'code', 'http-request', 'delay', 'custom'
    ]
    expect(new Set(registry.registeredKinds())).toEqual(new Set(expected))
  })

  it('dispatches through distinct registered family adapters', async () => {
    const registry = createWorkflowNodeExecutorRegistry<string>()
    const calls: string[] = []
    const context = {
      executeCore: async (node: WorkflowNodeV1) => `core:${node.type}`,
      executeAi: async (node: WorkflowNodeV1) => `ai:${node.type}`,
      executeImage: async (node: WorkflowNodeV1) => `image:${node.type}`,
      executeCode: async (node: WorkflowNodeV1) => `code:${node.type}`,
      executeNested: async (node: WorkflowNodeV1) => `nested:${node.type}`,
      executeHttp: async (node: WorkflowNodeV1) => `http:${node.type}`,
      executeApproval: async (node: WorkflowNodeV1) => `approval:${node.type}`,
      executeCustom: async (node: WorkflowNodeV1) => `custom:${node.type}`
    }
    for (const node of [
      { type: 'delay' },
      { type: 'ai-agent' },
      { type: 'generate-image' },
      { type: 'code' },
      { type: 'loop' },
      { type: 'http-request' },
      { type: 'human-approval' },
      { type: 'custom' }
    ] as WorkflowNodeV1[]) {
      calls.push(await registry.execute(node, context))
    }
    expect(calls).toEqual([
      'core:delay',
      'ai:ai-agent',
      'image:generate-image',
      'code:code',
      'nested:loop',
      'http:http-request',
      'approval:human-approval',
      'custom:custom'
    ])
  })
})
