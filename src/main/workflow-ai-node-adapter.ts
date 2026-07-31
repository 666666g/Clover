import type { AppSettingsV1, WorkflowInputFieldV1, WorkflowNodeV1 } from '../shared/app-settings'
import {
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  summarizeTaskResult,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'
import {
  buildAiPrompt,
  interpolate,
  safeJson,
  type InterpScope,
  type WorkflowPayload
} from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'

const AI_NODE_RESPONSE_TIMEOUT_MS = 30 * 60_000
type AiNode = Extract<WorkflowNodeV1, {
  type: 'ai-agent' | 'parameter-extractor' | 'question-classifier'
}>

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parse = (candidate: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(candidate) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch { return null }
  }
  return parse(text) ?? (text.match(/\{[\s\S]*\}/)?.[0] ? parse(text.match(/\{[\s\S]*\}/)![0]) : null)
}

function coerceField(field: WorkflowInputFieldV1, raw: unknown): unknown {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  switch (field.type) {
    case 'number': return Number.isFinite(Number(raw)) ? Number(raw) : field.defaultValue ? Number(field.defaultValue) : 0
    case 'boolean': return raw === true || text.toLowerCase() === 'true' || text === '1'
    case 'json':
      if (typeof raw === 'object' && raw !== null) return raw
      try { return JSON.parse(text) } catch { return null }
    default: return text || field.defaultValue || ''
  }
}

export async function executeAiWorkflowNode(input: {
  node: AiNode
  payload: WorkflowPayload
  settings: AppSettingsV1
  deps: ScheduleRuntimeDeps
  runWorkspace: string
  scope: InterpScope
  signal?: AbortSignal
}): Promise<WorkflowNodeOutcome> {
  const { node, payload, settings, deps, runWorkspace, scope } = input
  const modelConfig = resolveScheduleModelConfig(
    settings,
    {
      providerId: node.config.providerId,
      model: node.config.model.trim() || settings.agents.kun.model,
      reasoningEffort: node.config.reasoningEffort
    },
    settings.workflow.providerId?.trim() || ''
  )
  const workspace = runWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot

  if (node.type === 'ai-agent') {
    const configuredWorkspace = interpolate(node.config.workspaceRoot, payload, scope).trim()
    const result = await runPromptViaRuntime(deps, settings, {
      prompt: buildAiPrompt(node.config.prompt, payload, scope),
      title: `[Workflow] ${node.name || 'AI task'}`.trim(),
      workspaceRoot: configuredWorkspace || workspace,
      model: modelConfig.model,
      ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
      reasoningEffort: modelConfig.reasoningEffort,
      mode: node.config.mode,
      waitForResult: true,
      responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {})
    })
    if (!result.ok) throw new Error(result.message)
    const text = result.text ?? ''
    return { payload: { json: { text }, text }, message: summarizeTaskResult(text), threadId: result.threadId }
  }

  const sourceText = node.config.source.trim() ? interpolate(node.config.source, payload, scope) : payload.text
  if (node.type === 'parameter-extractor') {
    const fields = node.config.fields.map((field) =>
      `- ${field.key}${field.required ? ' (required)' : ''}: ${field.type}` +
      `${field.description ? ` — ${field.description}` : ''}` +
      `${field.type === 'select' && field.options.length ? ` (one of: ${field.options.join(', ')})` : ''}`
    ).join('\n')
    const prompt = `${node.config.instruction ? `${node.config.instruction}\n\n` : ''}` +
      `Extract these fields from the text and reply with ONLY a JSON object using exactly these keys (no markdown, no prose):\n${fields}\n\nText:\n${sourceText}`
    const result = await runPromptViaRuntime(deps, settings, {
      prompt,
      title: `[Workflow] ${node.name || 'Extract'}`.trim(),
      workspaceRoot: workspace,
      model: modelConfig.model,
      ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
      reasoningEffort: modelConfig.reasoningEffort,
      mode: 'agent', waitForResult: true, responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {})
    })
    if (!result.ok) throw new Error(result.message)
    const parsed = extractJsonObject(result.text ?? '')
    const json: Record<string, unknown> = {}
    for (const field of node.config.fields) json[field.key] = coerceField(field, parsed?.[field.key])
    return { payload: { json, text: safeJson(json) }, message: 'extracted', threadId: result.threadId }
  }

  const categories = node.config.categories
  if (categories.length === 0) return { payload, message: 'no categories' }
  const list = categories.map((category, index) => `${index + 1}. ${category.label}`).join('\n')
  const prompt = `${node.config.instruction ? `${node.config.instruction}\n\n` : ''}` +
    `Classify the text into exactly one of these categories. Reply with ONLY the category number (1-${categories.length}):\n${list}\n\nText:\n${sourceText}`
  const result = await runPromptViaRuntime(deps, settings, {
    prompt,
    title: `[Workflow] ${node.name || 'Classify'}`.trim(),
    workspaceRoot: workspace,
    model: modelConfig.model,
    ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
    reasoningEffort: modelConfig.reasoningEffort,
    mode: 'agent', waitForResult: true, responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {})
  })
  if (!result.ok) throw new Error(result.message)
  const number = Number.parseInt((result.text ?? '').match(/\d+/)?.[0] ?? '', 10)
  const chosen = categories[Number.isFinite(number) && number >= 1 && number <= categories.length ? number - 1 : 0]
  return { payload, message: `→ ${chosen.label}`, branch: chosen.id, threadId: result.threadId }
}
