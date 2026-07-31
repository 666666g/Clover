import type { ThreadRecord } from '../contracts/threads.js'
import { makeErrorItem } from '../domain/item.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { withThreadStoreMutation } from '../services/thread-mutation-coordinator.js'
import type { TurnService } from '../services/turn-service.js'
import type { UsageService } from '../services/usage-service.js'

export type TurnBudgetGateDeps = {
  threadStore: ThreadStore
  turns: Pick<TurnService, 'applyItem'>
  events: Pick<RuntimeEventRecorder, 'record'>
  usage: Pick<UsageService, 'forThread'>
  nowIso: () => string
}

export type ModelRequestReservation =
  | { allowed: true; counted: false }
  | { allowed: true; counted: true; count: number }
  | { allowed: false; reason: string }

/**
 * Atomically reserves one extension-run model request against the latest
 * persisted turn. Reading and incrementing under the per-thread mutation lock
 * prevents an auxiliary compaction request and the main request from writing
 * the same stale counter value.
 */
export async function reserveExtensionModelRequest(input: {
  threadStore: ThreadStore
  usage: Pick<UsageService, 'forThread'>
  nowIso: () => string
  threadId: string
  turnId: string
  /** Validate without incrementing an already-reserved main request. */
  reserve?: boolean
}): Promise<ModelRequestReservation> {
  return withThreadStoreMutation(input.threadStore, input.threadId, async () => {
    const current = await input.threadStore.get(input.threadId)
    if (!current) {
      return { allowed: false, reason: `Extension model-request owner thread is unavailable: ${input.threadId}.` }
    }
    const extensionBudget = current.extensionBudget
    if (!extensionBudget) return { allowed: true, counted: false }
    const turn = current.turns.find((candidate) => candidate.id === input.turnId)
    if (!turn) {
      return { allowed: false, reason: `Extension model-request owner turn is unavailable: ${input.turnId}.` }
    }

    const cumulativeTokens = input.usage.forThread(input.threadId).totalTokens
    const usedTokens = Math.max(0, cumulativeTokens - (turn.extensionBudgetTokenBaseline ?? 0))
    if (usedTokens >= extensionBudget.maxTokens) {
      return {
        allowed: false,
        reason: `Extension token budget exhausted: ${usedTokens} used of ${extensionBudget.maxTokens}.`
      }
    }

    const startedAt = Date.parse(turn.startedAt ?? turn.createdAt)
    const now = Date.parse(input.nowIso())
    const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(now)
      ? Math.max(0, now - startedAt)
      : 0
    if (elapsedMs >= extensionBudget.maxElapsedMs) {
      return {
        allowed: false,
        reason: `Extension elapsed-time budget exhausted after ${elapsedMs}ms.`
      }
    }

    if (input.reserve === false) return { allowed: true, counted: false }

    const modelRequests = turn.extensionModelRequests ?? 0
    if (modelRequests >= extensionBudget.maxModelRequests) {
      return {
        allowed: false,
        reason:
          `Extension model-request budget exhausted: ${modelRequests} used of ${extensionBudget.maxModelRequests}.`
      }
    }

    const count = modelRequests + 1
    await input.threadStore.upsert({
      ...current,
      turns: current.turns.map((candidate) =>
        candidate.id === input.turnId
          ? { ...candidate, extensionModelRequests: count }
          : candidate
      ),
      updatedAt: input.nowIso()
    })
    return { allowed: true, counted: true, count }
  })
}

/** Enforces goal-token and per-thread cost budgets before a model request. */
export class TurnBudgetGate {
  constructor(private readonly deps: TurnBudgetGateDeps) {}

  async check(
    thread: ThreadRecord,
    threadId: string,
    turnId: string,
    options: { reserveModelRequest?: boolean } = {}
  ): Promise<'allow' | 'blocked'> {
    if (thread.goal?.status === 'usageLimited') {
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: `Goal token budget exhausted: ${thread.goal.tokensUsed} used of ${thread.goal.tokenBudget ?? 0}.`,
        code: 'goal_token_budget_limited',
        severity: 'warning'
      })
      return 'blocked'
    }
    const budget = thread.costBudgetUsd
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
      return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
    }
    const spent = this.deps.usage.forThread(threadId).costUsd ?? 0
    if (spent >= budget) {
      const message =
        `Cost budget exhausted for this thread: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_limited`,
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      })
      return 'blocked'
    }
    if (spent >= budget * 0.8 && thread.costBudgetWarningSent !== true) {
      const message =
        `Cost budget warning: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      const warningMarked = await withThreadStoreMutation(
        this.deps.threadStore,
        threadId,
        async () => {
          const current = await this.deps.threadStore.get(threadId)
          if (!current) return false
          const currentBudget = current.costBudgetUsd
          if (
            typeof currentBudget !== 'number' ||
            !Number.isFinite(currentBudget) ||
            currentBudget <= 0 ||
            spent < currentBudget * 0.8 ||
            current.costBudgetWarningSent === true
          ) {
            return false
          }
          await this.deps.threadStore.upsert({
            ...current,
            costBudgetWarningSent: true,
            updatedAt: this.deps.nowIso()
          })
          return true
        }
      )
      if (!warningMarked) {
        return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
      }
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_warning`,
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      })
    }
    return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
  }

  /** Reserve an auxiliary model call without terminating the run when no slot remains. */
  reserveAdditionalModelRequest(threadId: string, turnId: string): Promise<ModelRequestReservation> {
    return reserveExtensionModelRequest({
      threadStore: this.deps.threadStore,
      usage: this.deps.usage,
      nowIso: this.deps.nowIso,
      threadId,
      turnId
    })
  }

  /**
   * Re-evaluate usage/cost/elapsed limits after an auxiliary model call while
   * preserving the main request's existing atomic reservation.
   */
  async recheckReservedMainModelRequest(threadId: string, turnId: string): Promise<'allow' | 'blocked'> {
    const current = await this.deps.threadStore.get(threadId)
    if (!current) return 'blocked'
    return this.check(current, threadId, turnId, { reserveModelRequest: false })
  }

  private async reserveMainModelRequest(
    thread: ThreadRecord,
    threadId: string,
    turnId: string,
    reserve: boolean
  ): Promise<'allow' | 'blocked'> {
    if (!thread.extensionBudget) return 'allow'
    const reservation = await reserveExtensionModelRequest({
      threadStore: this.deps.threadStore,
      usage: this.deps.usage,
      nowIso: this.deps.nowIso,
      threadId,
      turnId,
      reserve
    })
    if (reservation.allowed) return 'allow'
    return this.blockExtensionBudget(threadId, turnId, reservation.reason)
  }

  private async blockExtensionBudget(
    threadId: string,
    turnId: string,
    message: string
  ): Promise<'blocked'> {
    await this.deps.turns.applyItem(threadId, makeErrorItem({
      id: `item_${turnId}_extension_budget_limited`,
      threadId,
      turnId,
      message,
      code: 'extension_budget_exhausted'
    }))
    await this.deps.events.record({
      kind: 'error',
      threadId,
      turnId,
      message,
      code: 'extension_budget_exhausted',
      severity: 'warning'
    })
    return 'blocked'
  }
}
