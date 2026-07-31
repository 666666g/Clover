import { describe, expect, it } from 'vitest'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import {
  SUBAGENT_RECALL_TOP_K,
  SubagentRouter,
  customSubagentProfile,
  recallSubagents,
  subagentTaskRequiresReadOnly,
  type SubagentRoutingDocument
} from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'

class RouterModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'main-model'
  readonly requests: ModelRequest[] = []
  constructor(private readonly response: string, private readonly reasoning = '') {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.reasoning) yield { kind: 'assistant_reasoning_delta', text: this.reasoning }
    yield { kind: 'assistant_text_delta', text: this.response }
    yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class HangingRouterModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'hanging-model'
  stream(): AsyncIterable<ModelStreamChunk> {
    return { [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined),
      return: async () => ({ done: true, value: undefined })
    }) }
  }
}

describe('subagent BM25 recall', () => {
  it('recalls at most five standalone agent profiles with stable ranking', () => {
    const documents = [
      profile('security-auditor', 'Security Auditor', 'security vulnerability threat audit'),
      profile('code-reviewer', 'Code Reviewer', 'code security correctness review'),
      profile('explore', 'Explore', 'search and inspect security code'),
      profile('design-reviewer', 'Design Reviewer', 'UI security design review'),
      profile('test-engineer', 'Test Engineer', 'security testing coverage QA'),
      profile('security-and-hardening', 'Security Hardener', 'security hardening vulnerability prevention'),
      profile('shipping-and-launch', 'Release Manager', 'security release validation')
    ]
    const hits = recallSubagents('安全漏洞审计与威胁分析', documents)
    expect(hits).toHaveLength(SUBAGENT_RECALL_TOP_K)
    expect(hits[0]).toMatchObject({ kind: 'profile', targetId: 'security-auditor' })
    expect(hits.every((hit) => hit.kind === 'profile' && hit.score > 0)).toBe(true)
  })

  it('does not index executable workspace agent instructions', () => {
    const hits = recallSubagents('secret routing keyword', [{
      ...profile('workspace-agent', 'Workspace Agent', 'Handles documentation.'),
      source: 'workspace',
      profile: {
        mode: 'subagent', toolPolicy: 'inherit', name: 'Workspace Agent',
        description: 'Handles documentation.', systemPrompt: 'secret routing keyword'
      }
    }])
    expect(hits).toEqual([])
  })

  it('recalls workspace agents by description without indexing systemPrompt body', () => {
    const hits = recallSubagents('unique workspace API contract review', [{
      kind: 'profile',
      id: 'workspace-api-reviewer',
      source: 'workspace',
      profile: {
        mode: 'subagent',
        toolPolicy: 'readOnly',
        name: 'Workspace API Reviewer',
        description: 'unique workspace API contract review',
        systemPrompt: 'never index this private instruction token xyzzy-private'
      }
    }])
    expect(hits[0]).toMatchObject({ targetId: 'workspace-api-reviewer', source: 'workspace' })
    expect(recallSubagents('xyzzy-private', [{
      kind: 'profile',
      id: 'workspace-api-reviewer',
      source: 'workspace',
      profile: {
        mode: 'subagent',
        toolPolicy: 'readOnly',
        name: 'Workspace API Reviewer',
        description: 'unique workspace API contract review',
        systemPrompt: 'never index this private instruction token xyzzy-private'
      }
    }])).toEqual([])
  })

  it('treats common explicit no-mutation language as a hard read-only ceiling', () => {
    for (const task of [
      "Review the implementation, but don't edit code",
      'Diagnose this with no changes',
      'Never modify files while investigating',
      '排查这个问题，无需修改代码'
    ]) {
      expect(subagentTaskRequiresReadOnly(task), task).toBe(true)
    }
    expect(subagentTaskRequiresReadOnly('Review and fix the implementation')).toBe(false)
  })

  it('meets Recall@5 for representative bilingual tasks against the real catalog', () => {
    const documents = Object.entries(BUILTIN_SUBAGENT_PROFILES).map(([id, agentProfile]) => ({
      kind: 'profile' as const,
      id,
      source: 'builtin' as const,
      profile: agentProfile,
      routingTerms: BUILTIN_AGENT_CATALOG_BY_ID[id]?.routingTerms
    }))
    const cases: Array<[string, string]> = [
      ['帮我修复登录接口的鉴权漏洞并补测试', 'security-and-hardening'],
      ['把这个大需求拆成可以并行的任务', 'planning-and-task-breakdown'],
      ['排查 Electron IPC 偶发超时但不要修改代码', 'debugging-and-error-recovery'],
      ['优化首页 LCP 和 bundle size', 'performance-optimization'],
      [`${'背景资料与历史讨论'.repeat(80)} 最终任务：修复登录鉴权漏洞`, 'security-and-hardening'],
      ['为这篇产品文章设计论证大纲和章节结构', 'write-outline-architect'],
      ['核查稿件里的日期、数字和事实陈述', 'write-fact-checker'],
      ['为产品设计完整的响应式页面和交互状态', 'design-screen-designer']
    ]
    for (const [query, expected] of cases) {
      const ids = recallSubagents(query, documents).map((hit) => hit.targetId)
      expect(ids, query).toContain(expected)
      expect(ids[0], query).toBe(expected)
    }
  })
})

describe('SubagentRouter', () => {
  it('uses the small model and accepts only a profile from BM25 Top-5', async () => {
    const model = new RouterModel(JSON.stringify({
      decision: 'profile', targetId: 'security-auditor', confidence: 0.94, reason: 'Exact specialty.'
    }))
    const usage: string[] = []
    const router = new SubagentRouter({
      modelClient: model,
      roles: () => ({ smallModel: 'small-router', smallModelProviderId: 'cheap-provider' }),
      recordUsage: (event) => { usage.push(`${event.turnId}:${event.usage.totalTokens}`) }
    })
    const result = await router.route({
      threadId: 'thr_1', turnId: 'turn_1', task: 'Perform a security vulnerability audit',
      documents: [profile('security-auditor', 'Security Auditor', 'security vulnerability audit')],
      abortSignal: new AbortController().signal
    })
    expect(result).toMatchObject({ source: 'llm-profile', profileId: 'security-auditor', confidence: 0.94 })
    expect(model.requests[0]).toMatchObject({
      model: 'small-router', providerId: 'cheap-provider', tools: [], responseFormat: 'json_object', reasoningEffort: 'off'
    })
    expect(usage).toEqual(['turn_1_subagent_router:15'])
  })

  it('returns a separate generation brief instead of writing a system prompt in the judge', async () => {
    const model = new RouterModel(JSON.stringify({
      decision: 'generate', roleBrief: 'Electron IPC contract investigator with a file-cited report.',
      permissionHint: 'readOnly', confidence: 0.91, reason: 'No candidate owns this boundary.'
    }))
    const router = new SubagentRouter({ modelClient: model, defaultModel: () => 'router-model' })
    const result = await router.route({
      threadId: 'thr_new', turnId: 'turn_new', task: 'Investigate a novel Electron IPC issue',
      documents: [], abortSignal: new AbortController().signal
    })
    expect(result).toMatchObject({
      source: 'llm-generate',
      generate: { roleBrief: expect.stringContaining('Electron IPC'), permissionHint: 'readOnly' }
    })
    expect(result).not.toHaveProperty('customAgent')
  })

  it('rejects an id outside Top-5 and only falls back to an explicitly named profile', async () => {
    const router = new SubagentRouter({
      modelClient: new RouterModel('{"decision":"profile","targetId":"ghost","confidence":0.99}'),
      defaultModel: () => 'router-model'
    })
    const result = await router.route({
      threadId: 'thr_bad', turnId: 'turn_bad', task: 'Use security-auditor for this audit',
      documents: [profile('security-auditor', 'Security Auditor', 'security audit')],
      abortSignal: new AbortController().signal
    })
    expect(result).toMatchObject({ source: 'fallback-profile', profileId: 'security-auditor' })
  })

  it('falls back to generation for weak lexical overlap or a hung model', async () => {
    const weak = new SubagentRouter({ modelClient: new RouterModel('invalid'), defaultModel: () => 'router-model' })
    const weakResult = await weak.route({
      threadId: 'thr_weak', turnId: 'turn_weak', task: 'Review an unfamiliar deployment protocol',
      documents: [profile('code-reviewer', 'Code Reviewer', 'code review correctness')],
      abortSignal: new AbortController().signal
    })
    expect(weakResult).toMatchObject({ source: 'fallback-generate', generate: { permissionHint: 'readOnly' } })

    const hanging = new SubagentRouter({ modelClient: new HangingRouterModel(), defaultModel: () => 'router-model' })
    const started = Date.now()
    const hungResult = await hanging.route({
      threadId: 'thr_hang', turnId: 'turn_hang', task: 'novel protocol', documents: [],
      abortSignal: new AbortController().signal, timeoutMs: 20
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(hungResult.source).toBe('fallback-generate')
    expect(hungResult.generate?.permissionHint).toBe('readOnly')
  })

  it('does not execute a low-confidence profile and fails closed on invalid routing', async () => {
    const lowConfidence = new SubagentRouter({
      modelClient: new RouterModel(JSON.stringify({
        decision: 'profile', targetId: 'general', confidence: 0.2, reason: 'Weak fit.'
      })),
      defaultModel: () => 'router-model'
    })
    await expect(lowConfidence.route({
      threadId: 'thr_low', turnId: 'turn_low', task: 'Implement a novel binary protocol',
      documents: [profile('general', 'General', 'general implement protocol')],
      abortSignal: new AbortController().signal
    })).resolves.toMatchObject({
      source: 'llm-generate',
      generate: { permissionHint: 'readOnly' }
    })

    const invalid = new SubagentRouter({ modelClient: new RouterModel('invalid'), defaultModel: () => 'router-model' })
    await expect(invalid.route({
      threadId: 'thr_fail_closed', turnId: 'turn_fail_closed', task: 'Implement and remove old code',
      documents: [], abortSignal: new AbortController().signal
    })).resolves.toMatchObject({ generate: { permissionHint: 'readOnly' } })
  })

  it('propagates parent cancellation instead of converting it into a fallback route', async () => {
    const controller = new AbortController()
    const router = new SubagentRouter({ modelClient: new HangingRouterModel(), defaultModel: () => 'router-model' })
    const pending = router.route({
      threadId: 'thr_abort', turnId: 'turn_abort', task: 'novel protocol', documents: [],
      abortSignal: controller.signal, timeoutMs: 1_000
    })
    controller.abort()
    await expect(pending).rejects.toThrow('aborted by parent')
  })

  it('keeps explicit custom roles standalone from skills and delegation', () => {
    expect(customSubagentProfile({
      name: 'IPC Investigator', description: 'Investigates IPC.', systemPrompt: 'Trace IPC and cite evidence.',
      toolPolicy: 'readOnly'
    })).toMatchObject({
      mode: 'subagent', toolPolicy: 'readOnly', skillsEnabled: false,
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill']
    })
  })
})

function profile(id: string, name: string, description: string): SubagentRoutingDocument {
  return { kind: 'profile', id, source: 'configured', profile: { mode: 'subagent', toolPolicy: 'readOnly', name, description } }
}
