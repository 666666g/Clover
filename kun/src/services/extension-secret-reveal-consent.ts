import { randomUUID } from 'node:crypto'
import type { ExtensionPrincipal } from './extension-agent-service.js'

export type ExtensionSecretRevealRequest = {
  id: string
  extensionId: string
  extensionVersion: string
  accountId: string
  operation: string
  createdAt: string
  expiresAt: string
}

type PendingReveal = {
  request: ExtensionSecretRevealRequest
  resolve(allowed: boolean): void
  timeout: NodeJS.Timeout
  abortCleanup?: () => void
}

/**
 * Core-owned rendezvous between a Node Extension Host and Electron Main.
 * Requests are bounded, short-lived, operation-bound, and never contain the
 * secret itself. Headless runtimes fail closed when no trusted host decides.
 */
export class ExtensionSecretRevealConsentService {
  private readonly pending = new Map<string, PendingReveal>()

  constructor(
    private readonly options: {
      now?: () => Date
      ttlMs?: number
      maximumPending?: number
      maximumPerExtension?: number
    } = {}
  ) {}

  authorize(input: {
    principal: ExtensionPrincipal
    accountId: string
    operation: string
    signal?: AbortSignal
  }): Promise<boolean> {
    this.prune()
    const maximum = Math.max(1, this.options.maximumPending ?? 32)
    const maximumPerExtension = Math.max(1, this.options.maximumPerExtension ?? 3)
    if (this.pending.size >= maximum) return Promise.resolve(false)
    if (
      [...this.pending.values()].filter(
        ({ request }) => request.extensionId === input.principal.extensionId
      ).length >= maximumPerExtension
    ) return Promise.resolve(false)
    if (input.signal?.aborted) return Promise.resolve(false)

    const now = this.now()
    const ttlMs = Math.min(5 * 60_000, Math.max(5_000, this.options.ttlMs ?? 60_000))
    const request: ExtensionSecretRevealRequest = {
      id: `secret_reveal_${randomUUID()}`,
      extensionId: input.principal.extensionId,
      extensionVersion: input.principal.extensionVersion,
      accountId: input.accountId,
      operation: input.operation.slice(0, 256),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    }
    return new Promise<boolean>((resolve) => {
      const settle = (allowed: boolean): void => {
        const pending = this.pending.get(request.id)
        if (!pending) return
        this.pending.delete(request.id)
        clearTimeout(pending.timeout)
        pending.abortCleanup?.()
        resolve(allowed)
      }
      const timeout = setTimeout(() => settle(false), ttlMs)
      timeout.unref?.()
      const pending: PendingReveal = { request, resolve: settle, timeout }
      if (input.signal) {
        const abort = () => settle(false)
        input.signal.addEventListener('abort', abort, { once: true })
        pending.abortCleanup = () => input.signal?.removeEventListener('abort', abort)
      }
      this.pending.set(request.id, pending)
    })
  }

  list(): ExtensionSecretRevealRequest[] {
    this.prune()
    return [...this.pending.values()]
      .map(({ request }) => structuredClone(request))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  decide(requestId: string, decision: 'allow' | 'deny'): boolean {
    this.prune()
    const pending = this.pending.get(requestId)
    if (!pending) return false
    pending.resolve(decision === 'allow')
    return true
  }

  dispose(): void {
    for (const pending of [...this.pending.values()]) pending.resolve(false)
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private prune(): void {
    const now = this.now().getTime()
    for (const pending of [...this.pending.values()]) {
      if (Date.parse(pending.request.expiresAt) <= now) pending.resolve(false)
    }
  }
}
