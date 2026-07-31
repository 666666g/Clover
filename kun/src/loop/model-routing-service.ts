import type { TurnItem } from '../contracts/items.js'
import type { ModelClient } from '../ports/model-client.js'
import {
  recentAutoRouterContext,
  resolveAutoModelRoute,
  type AutoModelRouteSelection
} from './auto-model-router.js'

export type ResolveTurnModelInput = {
  threadId: string
  turnId: string
  latestRequest: string
  items: readonly TurnItem[]
  signal: AbortSignal
  providerId?: string
  accountId?: string
  reasoningEffort?: string
  candidates: Array<string | undefined>
}

/** Caches one auto-routing selection per active turn without caching failures across turns. */
export class ModelRoutingService {
  private readonly autoModelRoutes = new Map<string, AutoModelRouteSelection>()

  constructor(private readonly modelClient: ModelClient) {}

  async resolve(input: ResolveTurnModelInput): Promise<{ model: string; reasoningEffort?: string }> {
    const requestedReasoningEffort = normalizeRequestedReasoningEffort(input.reasoningEffort)
    const resolved = resolveModelMode(...input.candidates)
    if (resolved.kind === 'fixed') {
      return {
        model: resolved.model,
        ...(requestedReasoningEffort ? { reasoningEffort: requestedReasoningEffort } : {})
      }
    }
    const key = autoModelRouteKey(input.threadId, input.turnId)
    const cached = this.autoModelRoutes.get(key)
    if (cached) {
      return {
        model: cached.model,
        reasoningEffort: requestedReasoningEffort ?? cached.reasoningEffort
      }
    }
    const route = await resolveAutoModelRoute({
      modelClient: this.modelClient,
      threadId: input.threadId,
      turnId: input.turnId,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      latestRequest: input.latestRequest,
      recentContext: recentAutoRouterContext(input.items, input.turnId),
      selectedModelMode: 'auto',
      abortSignal: input.signal
    })
    this.autoModelRoutes.set(key, route)
    return {
      model: route.model,
      reasoningEffort: requestedReasoningEffort ?? route.reasoningEffort
    }
  }

  clear(threadId: string, turnId: string): void {
    this.autoModelRoutes.delete(autoModelRouteKey(threadId, turnId))
  }
}

function resolveModelMode(...candidates: Array<string | undefined>): { kind: 'fixed'; model: string } | { kind: 'auto' } {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? ''
    if (!trimmed) continue
    return trimmed.toLowerCase() === 'auto'
      ? { kind: 'auto' }
      : { kind: 'fixed', model: trimmed }
  }
  return { kind: 'fixed', model: '' }
}

function normalizeRequestedReasoningEffort(effort: string | undefined): string | undefined {
  const normalized = effort?.trim().toLowerCase()
  return normalized && normalized !== 'auto' ? normalized : undefined
}

function autoModelRouteKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`
}
