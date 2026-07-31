import type { ApprovalRequest } from '../domain/approval.js'

/**
 * Port for the approval flow used by tool execution. The local gate
 * is the in-process registry; a remote gate could integrate with an
 * external service. The loop awaits a `decide` resolution before
 * proceeding with a tool call.
 */
export interface ApprovalGate {
  request(approval: ApprovalRequest): Promise<'allow' | 'deny'>
  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean
  /** Reserve a decision while its durable audit event is being committed. */
  reserveDecision(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean
  /** Release the waiter only after the reserved audit event is durable. */
  commitDecision(approvalId: string): boolean
  /** Restore a pending approval when audit persistence fails. */
  rollbackDecision(approvalId: string): boolean
  /** Expire a pending decision when its owning turn is cancelled or shuts down. */
  expire(approvalId: string, reason?: string): boolean
  pending(threadId?: string): ApprovalRequest[]
  get(approvalId: string): ApprovalRequest | undefined
}
