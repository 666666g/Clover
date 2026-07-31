import { createHash, randomBytes } from 'node:crypto'

const DEFAULT_CONSENT_TTL_MS = 60_000
const MAX_CONSENT_TTL_MS = 5 * 60_000

export type ExtensionConsentBinding = {
  extensionId: string
  extensionVersion: string
  operationKind: string
  parameters: unknown
  workspaceRoot?: string
  senderId: number
  protectedWindowSessionId: string
}

type StoredConsentToken = {
  tokenDigest: string
  bindingDigest: string
  protectedWindowSessionId: string
  expiresAt: number
}

type StoredConsentHandle = {
  token: string
  binding: ExtensionConsentBinding
  expiresAt: number
}

export class ExtensionConsentError extends Error {
  constructor(
    readonly code:
      | 'EXTENSION_CONSENT_INVALID'
      | 'EXTENSION_CONSENT_EXPIRED'
      | 'EXTENSION_CONSENT_MISMATCH'
      | 'EXTENSION_CONSENT_REPLAYED',
    message: string
  ) {
    super(message)
    this.name = 'ExtensionConsentError'
  }
}

/**
 * Main-owned, short-lived consent tokens. Only a SHA-256 digest is retained;
 * the bearer value is never returned by the public preload bridge.
 */
export class ExtensionConsentTokenService {
  private readonly tokens = new Map<string, StoredConsentToken>()
  private readonly consumed = new Map<string, number>()

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = DEFAULT_CONSENT_TTL_MS
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_CONSENT_TTL_MS) {
      throw new Error(`Consent TTL must be between 1 and ${MAX_CONSENT_TTL_MS} ms.`)
    }
  }

  issue(binding: ExtensionConsentBinding): { token: string; expiresAt: number } {
    this.prune()
    const token = randomBytes(32).toString('base64url')
    const tokenDigest = digestText(token)
    const expiresAt = this.now() + this.ttlMs
    this.tokens.set(tokenDigest, {
      tokenDigest,
      bindingDigest: digestConsentBinding(binding),
      protectedWindowSessionId: binding.protectedWindowSessionId,
      expiresAt
    })
    return { token, expiresAt }
  }

  /**
   * Every consume attempt burns the token before checking the binding. This is
   * fail-closed and prevents a mismatched token from being used as an oracle.
   */
  consume(token: string, binding: ExtensionConsentBinding): void {
    const now = this.now()
    for (const [digest, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(digest)
    }
    const tokenDigest = digestText(token)
    if (this.consumed.has(tokenDigest)) {
      throw new ExtensionConsentError('EXTENSION_CONSENT_REPLAYED', 'Consent token was already used.')
    }
    const record = this.tokens.get(tokenDigest)
    if (!record) {
      throw new ExtensionConsentError('EXTENSION_CONSENT_INVALID', 'Consent token is invalid.')
    }
    this.tokens.delete(tokenDigest)
    this.consumed.set(tokenDigest, Math.max(record.expiresAt, now + this.ttlMs))
    if (record.expiresAt <= now) {
      throw new ExtensionConsentError('EXTENSION_CONSENT_EXPIRED', 'Consent token has expired.')
    }
    if (record.bindingDigest !== digestConsentBinding(binding)) {
      throw new ExtensionConsentError(
        'EXTENSION_CONSENT_MISMATCH',
        'Consent token does not authorize this operation.'
      )
    }
  }

  revokeProtectedWindowSession(protectedWindowSessionId: string): void {
    for (const [tokenDigest, record] of this.tokens) {
      if (record.protectedWindowSessionId === protectedWindowSessionId) {
        this.tokens.delete(tokenDigest)
      }
    }
  }

  prune(): void {
    const now = this.now()
    for (const [digest, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(digest)
    }
    for (const [digest, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(digest)
    }
  }
}

export type ProtectedConsentPrompt = (
  binding: ExtensionConsentBinding,
  copy: { title: string; message: string; detail?: string }
) => Promise<boolean>

/**
 * Bridges an ordinary trusted workbench request to a protected Main surface.
 * Renderer code receives only a random lookup handle; the actual consent token
 * and its binding never leave this class.
 */
export class ProtectedExtensionActionService {
  private readonly handles = new Map<string, StoredConsentHandle>()

  constructor(
    private readonly tokens: ExtensionConsentTokenService,
    private readonly prompt: ProtectedConsentPrompt,
    private readonly now: () => number = () => Date.now()
  ) {}

  async authorize(
    binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>,
    copy: { title: string; message: string; detail?: string }
  ): Promise<{ approved: false } | { approved: true; requestId: string; expiresAt: number }> {
    this.prune()
    const protectedWindowSessionId = randomBytes(18).toString('base64url')
    const completeBinding: ExtensionConsentBinding = { ...binding, protectedWindowSessionId }
    if (!(await this.prompt(completeBinding, copy))) return { approved: false }
    const issued = this.tokens.issue(completeBinding)
    const requestId = randomBytes(24).toString('base64url')
    this.handles.set(requestId, {
      token: issued.token,
      binding: completeBinding,
      expiresAt: issued.expiresAt
    })
    return { approved: true, requestId, expiresAt: issued.expiresAt }
  }

  consume(
    requestId: string,
    binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>
  ): void {
    this.prune()
    const handle = this.handles.get(requestId)
    if (!handle) {
      throw new ExtensionConsentError('EXTENSION_CONSENT_INVALID', 'Consent request is invalid.')
    }
    this.handles.delete(requestId)
    this.tokens.consume(handle.token, {
      ...binding,
      protectedWindowSessionId: handle.binding.protectedWindowSessionId
    })
  }

  async authorizeAndPerform<T>(
    binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>,
    copy: { title: string; message: string; detail?: string },
    perform: () => Promise<T>
  ): Promise<T | undefined> {
    const authorization = await this.authorize(binding, copy)
    if (!authorization.approved) return undefined
    this.consume(authorization.requestId, binding)
    return perform()
  }

  async performAfterProtectedDecision<T>(
    binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>,
    protectedWindowSessionId: string,
    perform: () => Promise<T>
  ): Promise<T> {
    const completeBinding: ExtensionConsentBinding = { ...binding, protectedWindowSessionId }
    const issued = this.tokens.issue(completeBinding)
    this.tokens.consume(issued.token, completeBinding)
    return perform()
  }

  revokeSender(senderId: number): void {
    for (const [requestId, handle] of this.handles) {
      if (handle.binding.senderId === senderId) this.handles.delete(requestId)
    }
  }

  private prune(): void {
    const now = this.now()
    for (const [requestId, handle] of this.handles) {
      if (handle.expiresAt <= now) this.handles.delete(requestId)
    }
    this.tokens.prune()
  }
}

export function digestConsentBinding(binding: ExtensionConsentBinding): string {
  return digestText(canonicalJson({
    extensionId: binding.extensionId,
    extensionVersion: binding.extensionVersion,
    operationKind: binding.operationKind,
    parameters: binding.parameters,
    workspaceRoot: binding.workspaceRoot ?? null,
    senderId: binding.senderId,
    protectedWindowSessionId: binding.protectedWindowSessionId
  }))
}

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  const canonicalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new TypeError('Consent parameters must contain finite numbers.')
      return Object.is(input, -0) ? 0 : input
    }
    if (Array.isArray(input)) return input.map(canonicalize)
    if (typeof input !== 'object') {
      throw new TypeError('Consent parameters must be JSON values.')
    }
    if (seen.has(input)) throw new TypeError('Consent parameters must not be cyclic.')
    seen.add(input)
    const record = input as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const child = record[key]
      if (child === undefined) throw new TypeError('Consent parameters must not contain undefined.')
      output[key] = canonicalize(child)
    }
    seen.delete(input)
    return output
  }
  return JSON.stringify(canonicalize(value))
}

function digestText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
