import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { SubagentGenerator, generatedSubagentProfileId } from './subagent-generator.js'
import type { SubagentRoutingDocument } from './subagent-router.js'

class GeneratorModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'test-model'
  readonly requests: ModelRequest[] = []
  constructor(private readonly response: string) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: this.response }
    yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 7, completionTokens: 3, totalTokens: 10 } }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('SubagentGenerator', () => {
  it('uses at most three trusted built-in examples and returns a standalone definition', async () => {
    const model = new GeneratorModel(JSON.stringify({
      name: 'Electron IPC Investigator',
      description: 'Diagnoses Electron IPC contract failures.',
      systemPrompt: 'You are an IPC investigator. Inspect boundaries, cite evidence, verify claims, return a report, and never delegate.',
      toolPolicy: 'readOnly',
      blockedTools: ['delegate_task'],
      reason: 'The fixed catalog lacks an Electron-specific boundary investigator.'
    }))
    const usageTurns: string[] = []
    const generator = new SubagentGenerator({
      modelClient: model,
      defaultModel: () => 'small-model',
      recordUsage: (event) => { usageTurns.push(`${event.turnId}:${event.usage.totalTokens}`) }
    })
    const result = await generator.generate({
      threadId: 'thr', turnId: 'turn', task: 'Investigate Electron IPC',
      documents: [builtin('explore'), builtin('api-and-interface-design'), builtin('debugging-and-error-recovery'), builtin('general')],
      referenceAgentIds: ['explore', 'api-and-interface-design', 'debugging-and-error-recovery'],
      abortSignal: new AbortController().signal
    })
    expect(result).toMatchObject({ source: 'llm-exemplars', referenceAgentIds: ['explore', 'api-and-interface-design', 'debugging-and-error-recovery'] })
    expect(result.definition).toMatchObject({
      name: 'Electron IPC Investigator', toolPolicy: 'readOnly',
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill']
    })
    expect(result.definition).not.toHaveProperty('reasoningEffort')
    expect(model.requests[0]?.turnId).toBe('turn_subagent_generator')
    expect(usageTurns).toEqual(['turn_subagent_generator:10'])
    expect(generatedSubagentProfileId(result.definition)).toMatch(/^generated:electron-ipc-investigator:[a-f0-9]{8}$/)
  })

  it('never includes workspace prompt bodies as examples and honors a narrower requested policy', async () => {
    const model = new GeneratorModel('invalid')
    const generator = new SubagentGenerator({ modelClient: model, defaultModel: () => 'small-model' })
    const result = await generator.generate({
      threadId: 'thr', turnId: 'turn', task: 'Review something', toolPolicy: 'readOnly',
      documents: [{ ...builtin('trusted'), source: 'workspace', profile: { ...builtin('trusted').profile, systemPrompt: 'SECRET WORKSPACE BODY' } }],
      abortSignal: new AbortController().signal
    })
    expect(result.source).toBe('deterministic-fallback')
    expect(result.definition.toolPolicy).toBe('readOnly')
    const item = model.requests[0]?.history[0]
    expect(item?.kind === 'user_message' ? item.text : '').not.toContain('SECRET WORKSPACE BODY')
  })

  it('fails closed for automatic generation and includes permissions in generated identity', async () => {
    const generator = new SubagentGenerator({ modelClient: new GeneratorModel('invalid'), defaultModel: () => 'small-model' })
    const result = await generator.generate({
      threadId: 'thr', turnId: 'turn', task: 'Implement and remove old code', documents: [],
      toolPolicy: 'auto', abortSignal: new AbortController().signal
    })
    expect(result.definition.toolPolicy).toBe('readOnly')
    const readOnlyId = generatedSubagentProfileId(result.definition)
    const inheritId = generatedSubagentProfileId({ ...result.definition, toolPolicy: 'inherit' })
    expect(readOnlyId).not.toBe(inheritId)
  })

  it('propagates an already-aborted parent signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const generator = new SubagentGenerator({ modelClient: new GeneratorModel('invalid'), defaultModel: () => 'small-model' })
    await expect(generator.generate({
      threadId: 'thr', turnId: 'turn', task: 'Investigate', documents: [], abortSignal: controller.signal
    })).rejects.toThrow('aborted by parent')
  })
})

function builtin(id: string): SubagentRoutingDocument {
  return {
    kind: 'profile', id, source: 'builtin',
    profile: {
      mode: 'subagent', toolPolicy: 'readOnly', name: id,
      description: `${id} specialist`, systemPrompt: `You are the ${id} specialist.`
    }
  }
}
