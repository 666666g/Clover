import type {
  TerminalTurnStatus,
  TurnService,
  TurnSettlement
} from '../services/turn-service.js'
import type { TurnExecutionFailure } from './turn-execution-types.js'

export type TurnFinalizationRequest = Readonly<{
  threadId: string
  turnId: string
  status: TerminalTurnStatus
} & Partial<TurnExecutionFailure>>

/**
 * Per-run terminal state guard. It collapses competing normal/error/timeout
 * paths into the first durable terminal request; TurnService remains the
 * cross-process/source-of-truth fence for externally interrupted turns.
 */
export class TurnFinalizer {
  private settled: Promise<TurnSettlement> | undefined

  constructor(private readonly turns: Pick<TurnService, 'finishTurn' | 'getTurn'>) {}

  async settle(input: TurnFinalizationRequest): Promise<TurnSettlement> {
    if (this.settled) return this.settled
    const pending = this.settleFirst(input)
    this.settled = pending
    try {
      return await pending
    } catch (error) {
      // Keep the original behavior of allowing the surrounding lifecycle
      // catch path to make one best-effort failure persistence retry.
      if (this.settled === pending) this.settled = undefined
      throw error
    }
  }

  /** Observe a terminal state owned by another runner, such as Agent SDK. */
  async observeExternal(input: {
    threadId: string
    turnId: string
  }): Promise<TurnSettlement> {
    const turn = await this.turns.getTurn(input.threadId, input.turnId)
    if (!turn) return { kind: 'missing' }
    if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
      return {
        kind: 'already_terminal',
        status: turn.status,
        ...(turn.error ? { error: turn.error } : {})
      }
    }
    throw new Error(`turn is still active after an external runner returned: ${input.turnId}`)
  }

  private async settleFirst(input: TurnFinalizationRequest): Promise<TurnSettlement> {
    try {
      return await this.turns.finishTurn(input)
    } catch (error) {
      // finishTurn can fail after its durable thread mutation but before a
      // terminal event/item is recorded. Re-read before retrying so that a
      // completed turn is never reclassified as failed or double-published.
      try {
        return await this.observeExternal(input)
      } catch {
        throw error
      }
    }
  }
}
