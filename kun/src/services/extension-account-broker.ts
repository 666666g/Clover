import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type {
  ExtensionAccountProjection,
  ExtensionAccountRecord,
  ExtensionProviderDefinition
} from '../contracts/extension-providers.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  assertBrokeredNetworkUrl,
  createSafeNetworkFetch,
  normalizedBrokerHostname
} from '../extensions/safe-network-fetch.js'
import {
  ExtensionCredentialStore,
  redactExtensionSecrets,
  type ExtensionCredentialPayload
} from './extension-credential-store.js'
import {
  ExtensionProviderAccountStore,
  projectExtensionAccount
} from './extension-provider-account-store.js'

type OAuthPkceTransaction = {
  id: string
  extensionId: string
  providerId: string
  label: string
  state: string
  verifier: string
  expiresAt: number
  consumed: boolean
  cancelled: boolean
}

type DeviceTransaction = {
  id: string
  extensionId: string
  providerId: string
  label: string
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalMs: number
  expiresAt: number
  cancelled: boolean
}

export type ExtensionAccountAuditEvent = {
  timestamp: string
  extensionId: string
  operation: string
  providerId?: string
  accountId?: string
  outcome: 'allowed' | 'denied' | 'failed'
  details?: Record<string, unknown>
}

export type ExtensionAccountBrokerOptions = {
  store: ExtensionProviderAccountStore
  credentials: ExtensionCredentialStore
  fetch?: typeof fetch
  now?: () => Date
  audit?: (event: ExtensionAccountAuditEvent) => Promise<void> | void
  maxPendingTransactions?: number
}

/** Core-owned account/authentication boundary. No method serializes secrets. */
export class ExtensionAccountBroker {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly pkce = new Map<string, OAuthPkceTransaction>()
  private readonly devices = new Map<string, DeviceTransaction>()
  private readonly refreshes = new Map<string, {
    promise: Promise<ExtensionCredentialPayload>
    controller: AbortController
  }>()
  private readonly accountMutations = new Map<string, Promise<void>>()
  private readonly maxPendingTransactions: number
  private readonly maxGlobalPendingTransactions: number

  constructor(private readonly options: ExtensionAccountBrokerOptions) {
    this.fetchImpl = options.fetch ?? createSafeNetworkFetch()
    this.now = options.now ?? (() => new Date())
    this.maxPendingTransactions = Math.max(1, options.maxPendingTransactions ?? 32)
    this.maxGlobalPendingTransactions = Math.max(64, this.maxPendingTransactions * 16)
  }

  async listAccounts(principal: ExtensionPrincipal, providerId?: string): Promise<ExtensionAccountProjection[]> {
    return this.options.store.listAccounts(principal, providerId)
  }

  async createApiKeyAccount(input: {
    principal: ExtensionPrincipal
    providerId: string
    label: string
    apiKey: string
    protectedInput: boolean
    metadata?: ExtensionAccountRecord['metadata']
  }): Promise<ExtensionAccountProjection> {
    this.requireManage(input.principal, input.providerId)
    if (!input.protectedInput) throw new Error('API keys must be entered through a protected core surface')
    const provider = await this.options.store.requireOwnedProvider(input.principal, input.providerId)
    if (!provider.authTypes.includes('api-key')) throw new Error('provider does not support API-key accounts')
    const apiKey = input.apiKey.trim()
    if (!apiKey) throw new Error('API key is required')
    let credentialRef: string | undefined
    try {
      credentialRef = await this.options.credentials.create({ apiKey })
      const account = await this.options.store.createAccount({
        principal: input.principal,
        providerId: provider.id,
        label: input.label,
        authType: 'api-key',
        credentialRef,
        metadata: input.metadata
      })
      await this.audit(input.principal, 'account.create.api-key', 'allowed', {
        providerId: provider.id, accountId: account.id
      })
      return account
    } catch (error) {
      if (credentialRef) await this.options.credentials.delete(credentialRef).catch(() => undefined)
      await this.audit(input.principal, 'account.create.api-key', 'failed', {
        providerId: provider.id, details: { error: safeError(error) }
      })
      throw error
    }
  }

  async renameAccount(input: {
    principal: ExtensionPrincipal
    accountId: string
    label: string
  }): Promise<ExtensionAccountProjection> {
    return this.serializeAccountMutation(input.accountId, async () => {
      const existing = await this.options.store.getAccount(input.accountId)
      if (!existing || existing.ownerExtensionId !== input.principal.extensionId) {
        throw new Error('account not found')
      }
      this.requireManage(input.principal, existing.providerId)
      const label = input.label.trim()
      if (!label || label.length > 128) throw new Error('account label must contain 1 to 128 characters')
      const updated = await this.options.store.updateAccount(existing.id, { label })
      await this.audit(input.principal, 'account.rename', 'allowed', {
        providerId: existing.providerId,
        accountId: existing.id
      })
      return projectExtensionAccount(updated)
    })
  }

  async replaceApiKeyAccount(input: {
    principal: ExtensionPrincipal
    accountId: string
    apiKey: string
    protectedInput: boolean
  }): Promise<ExtensionAccountProjection> {
    return this.serializeAccountMutation(input.accountId, async () => {
      const existing = await this.options.store.getAccount(input.accountId)
      if (!existing || existing.ownerExtensionId !== input.principal.extensionId) {
        throw new Error('account not found')
      }
      this.requireManage(input.principal, existing.providerId)
      if (!input.protectedInput) throw new Error('API keys must be entered through a protected core surface')
      if (existing.authType !== 'api-key') throw new Error('only API-key accounts can replace an API key')
      const provider = await this.options.store.requireOwnedProvider(input.principal, existing.providerId)
      if (!provider.authTypes.includes('api-key')) throw new Error('provider does not support API-key accounts')
      const apiKey = input.apiKey.trim()
      if (!apiKey) throw new Error('API key is required')

      try {
        // The credential store atomically replaces the encrypted value behind
        // the existing opaque reference. This keeps the account/binding ID
        // stable and leaves no second credential reference to orphan.
        await this.options.credentials.set(existing.credentialRef, { apiKey })
        const updated = await this.options.store.updateAccountIfCurrent(existing.id, {
          status: existing.status,
          credentialRef: existing.credentialRef
        }, {
          status: 'connected',
          expiresAt: undefined
        })
        if (!updated) throw new Error('account changed while the API key was being replaced')
        await this.audit(input.principal, 'account.replace.api-key', 'allowed', {
          providerId: existing.providerId,
          accountId: existing.id
        })
        return projectExtensionAccount(updated)
      } catch (error) {
        await this.audit(input.principal, 'account.replace.api-key', 'failed', {
          providerId: existing.providerId,
          accountId: existing.id,
          details: { error: safeError(error) }
        })
        throw error
      }
    })
  }

  async beginPkceAuthorization(input: {
    principal: ExtensionPrincipal
    providerId: string
    label: string
    scopes?: string[]
    headless?: boolean
  }): Promise<{
    status: 'interaction-required'
    transactionId: string
    authorizationUrl: string
    expiresAt: string
  }> {
    this.requireManage(input.principal, input.providerId)
    this.pruneTransactions()
    this.assertTransactionCapacity(input.principal.extensionId)
    const provider = await this.options.store.requireOwnedProvider(input.principal, input.providerId)
    const config = provider.oauthPkce
    if (!config) throw new Error('provider does not support OAuth PKCE')
    const scopes = requestedScopes(config.scopes, input.scopes)
    const id = `oauth_${randomUUID()}`
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const expiresAt = this.now().getTime() + 10 * 60_000
    this.pkce.set(id, {
      id,
      extensionId: input.principal.extensionId,
      providerId: provider.id,
      label: input.label,
      state,
      verifier,
      expiresAt,
      consumed: false,
      cancelled: false
    })
    const url = new URL(config.authorizationUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (scopes.length) url.searchParams.set('scope', scopes.join(' '))
    for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) url.searchParams.set(key, value)
    await this.audit(input.principal, 'account.oauth.pkce.begin', 'allowed', {
      providerId: provider.id,
      details: { scopes }
    })
    void input.headless
    return {
      status: 'interaction-required',
      transactionId: id,
      authorizationUrl: url.toString(),
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  async completePkceAuthorization(input: {
    principal: ExtensionPrincipal
    transactionId: string
    state: string
    code: string
    protectedCallback: boolean
  }): Promise<ExtensionAccountProjection> {
    if (!input.protectedCallback) throw new Error('OAuth callback must use the protected core boundary')
    const transaction = this.pkce.get(input.transactionId)
    if (
      !transaction ||
      transaction.consumed ||
      transaction.cancelled ||
      transaction.expiresAt <= this.now().getTime()
    ) {
      await this.audit(input.principal, 'account.oauth.callback', 'denied', {
        details: { reason: 'missing_expired_or_replayed' }
      })
      throw new Error('OAuth transaction is missing, expired, or already consumed')
    }
    if (transaction.extensionId !== input.principal.extensionId || !timingSafeTextEqual(transaction.state, input.state)) {
      await this.audit(input.principal, 'account.oauth.callback', 'denied', {
        providerId: transaction.providerId, details: { reason: 'state_mismatch' }
      })
      throw new Error('OAuth callback state is invalid')
    }
    transaction.consumed = true
    try {
      const provider = await this.options.store.requireOwnedProvider(
        input.principal,
        transaction.providerId
      )
      const config = provider.oauthPkce!
      const token = await this.tokenRequest(config.tokenUrl, {
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code_verifier: transaction.verifier
      })
      if (transaction.cancelled || this.pkce.get(transaction.id) !== transaction) {
        throw new Error('OAuth authorization cancelled')
      }
      // Cancellation is no longer accepted once persistence begins. This
      // prevents the UI from reporting cancelled while an account commits.
      this.pkce.delete(transaction.id)
      const account = await this.persistOAuthAccount(
        input.principal,
        provider,
        transaction.label,
        'oauth-pkce',
        token
      )
      await this.audit(input.principal, 'account.oauth.callback', 'allowed', {
        providerId: provider.id,
        accountId: account.id
      })
      return account
    } catch (error) {
      await this.audit(input.principal, 'account.oauth.callback', 'failed', {
        providerId: transaction.providerId,
        details: { error: safeError(error) }
      })
      throw error
    } finally {
      if (this.pkce.get(transaction.id) === transaction) this.pkce.delete(transaction.id)
    }
  }

  async beginDeviceAuthorization(input: {
    principal: ExtensionPrincipal
    providerId: string
    label: string
    scopes?: string[]
  }): Promise<{
    status: 'interaction-required'
    transactionId: string
    userCode: string
    verificationUri: string
    expiresAt: string
    intervalMs: number
  }> {
    this.requireManage(input.principal, input.providerId)
    this.pruneTransactions()
    this.assertTransactionCapacity(input.principal.extensionId)
    const provider = await this.options.store.requireOwnedProvider(input.principal, input.providerId)
    const config = provider.oauthDevice
    if (!config) throw new Error('provider does not support OAuth device authorization')
    const scopes = requestedScopes(config.scopes, input.scopes)
    const response = await this.formRequest(config.deviceAuthorizationUrl, {
      client_id: config.clientId,
      ...(scopes.length ? { scope: scopes.join(' ') } : {})
    })
    const deviceCode = requiredString(response.device_code, 'device_code')
    const userCode = requiredString(response.user_code, 'user_code')
    const verificationUri = requiredString(
      response.verification_uri ?? response.verification_url,
      'verification_uri'
    )
    if (userCode.length > 128) throw new Error('provider user_code exceeds 128 characters')
    if (verificationUri.length > 4_096) throw new Error('provider verification_uri exceeds 4096 characters')
    assertBrokeredNetworkUrl(new URL(verificationUri))
    const expiresIn = boundedPositiveNumber(response.expires_in, 600, 86_400)
    const intervalMs = Math.max(
      1_000,
      boundedPositiveNumber(response.interval, 5, 60) * 1_000
    )
    const id = `device_${randomUUID()}`
    const expiresAt = this.now().getTime() + expiresIn * 1_000
    this.devices.set(id, {
      id,
      extensionId: input.principal.extensionId,
      providerId: provider.id,
      label: input.label,
      deviceCode,
      userCode,
      verificationUri,
      intervalMs,
      expiresAt,
      cancelled: false
    })
    await this.audit(input.principal, 'account.oauth.device.begin', 'allowed', {
      providerId: provider.id,
      details: { scopes }
    })
    return {
      status: 'interaction-required', transactionId: id, userCode, verificationUri,
      expiresAt: new Date(expiresAt).toISOString(), intervalMs
    }
  }

  async completeDeviceAuthorization(input: {
    principal: ExtensionPrincipal
    transactionId: string
    signal?: AbortSignal
  }): Promise<ExtensionAccountProjection> {
    const transaction = this.devices.get(input.transactionId)
    if (!transaction || transaction.extensionId !== input.principal.extensionId) throw new Error('device transaction not found')
    const provider = await this.options.store.requireOwnedProvider(input.principal, transaction.providerId)
    const config = provider.oauthDevice!
    let interval = transaction.intervalMs
    while (!transaction.cancelled && this.now().getTime() < transaction.expiresAt) {
      if (input.signal?.aborted) throw new Error('device authorization cancelled')
      const response = await this.formRequest(config.tokenUrl, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: transaction.deviceCode,
        client_id: config.clientId
      }, true, input.signal)
      if (typeof response.access_token === 'string') {
        if (transaction.cancelled || this.devices.get(transaction.id) !== transaction) {
          throw new Error('device authorization cancelled')
        }
        // As with PKCE, cancellation stops being accepted before the secure
        // credential/account commit begins.
        this.devices.delete(transaction.id)
        const account = await this.persistOAuthAccount(
          input.principal,
          provider,
          transaction.label,
          'oauth-device',
          response
        )
        await this.audit(input.principal, 'account.oauth.device.complete', 'allowed', {
          providerId: provider.id,
          accountId: account.id
        })
        return account
      }
      const error = typeof response.error === 'string' ? response.error : 'authorization_pending'
      if (error === 'slow_down') interval += 5_000
      else if (error !== 'authorization_pending') throw new Error(`device authorization failed: ${error}`)
      await cancellableDelay(interval, input.signal)
    }
    this.devices.delete(transaction.id)
    await this.audit(input.principal, 'account.oauth.device.complete', 'failed', {
      providerId: transaction.providerId,
      details: { reason: transaction.cancelled ? 'cancelled' : 'expired' }
    })
    throw new Error(transaction.cancelled ? 'device authorization cancelled' : 'device authorization expired')
  }

  cancelAuthorization(principal: ExtensionPrincipal, transactionId: string): boolean {
    const pkce = this.pkce.get(transactionId)
    if (pkce?.extensionId === principal.extensionId && !pkce.consumed) {
      pkce.cancelled = true
      this.pkce.delete(transactionId)
      void this.audit(principal, 'account.authorization.cancel', 'allowed', {
        providerId: pkce.providerId,
        details: { type: 'oauth-pkce' }
      })
      return true
    }
    const device = this.devices.get(transactionId)
    if (device?.extensionId === principal.extensionId) {
      device.cancelled = true
      this.devices.delete(transactionId)
      void this.audit(principal, 'account.authorization.cancel', 'allowed', {
        providerId: device.providerId,
        details: { type: 'oauth-device' }
      })
      return true
    }
    return false
  }

  async authenticatedFetch(input: {
    principal: ExtensionPrincipal
    accountId: string
    url: string
    init?: RequestInit
  }): Promise<Response> {
    const account = await this.requireUsableAccount(input.principal, input.accountId)
    const provider = await this.requireProviderPermission(input.principal, account.providerId, 'use')
    const url = new URL(input.url)
    assertBrokeredNetworkUrl(url)
    const hostname = normalizedBrokerHostname(url)
    if (!hasNetworkPermission(input.principal.permissions, hostname)) {
      throw new Error(`Missing permission: network:${hostname}`)
    }
    if (!matchesHostnamePattern(provider.credentialHosts, hostname)) {
      throw new Error(`Provider credentials are not allowed for host: ${hostname}`)
    }
    const credential = await this.resolveCredential(account, provider)
    const headers = new Headers(input.init?.headers)
    if (headers.has('authorization') || provider.apiKey && headers.has(provider.apiKey.headerName)) {
      throw new Error('authenticated fetch cannot override broker-managed credentials')
    }
    injectCredential(headers, provider, account, credential)
    try {
      // Never automatically forward a broker-injected credential across an
      // upstream redirect. The extension may inspect Location and make a new
      // brokered request, which re-runs both network and credential-host gates.
      const response = await this.fetchImpl(url, { ...input.init, headers, redirect: 'manual' })
      return redactCredentialResponseHeaders(response, [
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        ...(provider.apiKey ? [provider.apiKey.headerName] : [])
      ])
    } finally {
      headers.delete('authorization')
      if (provider.apiKey) headers.delete(provider.apiKey.headerName)
    }
  }

  async revealSecret(input: {
    principal: ExtensionPrincipal
    accountId: string
    nodeHost: boolean
    protectedConsent: boolean
    operation: string
  }): Promise<ExtensionCredentialPayload> {
    const account = await this.requireUsableAccount(input.principal, input.accountId)
    const permission = `accounts.secrets.read:${account.providerId}`
    if (!input.nodeHost || !input.protectedConsent || !input.principal.permissions.includes(permission)) {
      await this.audit(input.principal, 'account.secret.reveal', 'denied', {
        providerId: account.providerId, accountId: account.id, details: { operation: input.operation }
      })
      throw new Error('raw secret access requires Node host permission and protected consent')
    }
    const secret = await this.options.credentials.get(account.credentialRef)
    if (!secret) throw new Error('account credential is unavailable')
    await this.audit(input.principal, 'account.secret.reveal', 'allowed', {
      providerId: account.providerId, accountId: account.id, details: { operation: input.operation }
    })
    return { ...secret }
  }

  async deleteAccount(principal: ExtensionPrincipal, accountId: string): Promise<boolean> {
    return this.serializeAccountMutation(accountId, async () => {
      const existing = await this.options.store.getAccount(accountId)
      if (!existing || existing.ownerExtensionId !== principal.extensionId) return false
      this.requireManage(principal, existing.providerId)
      // Tombstone first so no new request can start while an in-flight refresh
      // is being cancelled. Keep the credential reference until secure deletion
      // succeeds so a failed cleanup remains retryable.
      await this.options.store.updateAccount(accountId, { status: 'unavailable' })
      const refresh = this.refreshes.get(accountId)
      if (refresh) {
        refresh.controller.abort(new Error('account deleted'))
        await refresh.promise.catch(() => undefined)
      }
      await this.options.credentials.delete(existing.credentialRef)
      const removed = await this.options.store.deleteAccount(principal, accountId)
      if (!removed) return false
      await this.audit(principal, 'account.delete', 'allowed', {
        providerId: existing.providerId,
        accountId
      })
      return true
    })
  }

  private async persistOAuthAccount(
    principal: ExtensionPrincipal,
    provider: ExtensionProviderDefinition,
    label: string,
    authType: 'oauth-pkce' | 'oauth-device',
    token: Record<string, unknown>
  ): Promise<ExtensionAccountProjection> {
    const credential = credentialFromToken(token, this.now())
    let credentialRef: string | undefined
    try {
      credentialRef = await this.options.credentials.create(credential)
      return await this.options.store.createAccount({
        principal,
        providerId: provider.id,
        label,
        authType,
        credentialRef,
        ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {})
      })
    } catch (error) {
      if (credentialRef) await this.options.credentials.delete(credentialRef).catch(() => undefined)
      throw error
    }
  }

  private async resolveCredential(
    account: ExtensionAccountRecord,
    provider: ExtensionProviderDefinition
  ): Promise<ExtensionCredentialPayload> {
    const credential = await this.options.credentials.get(account.credentialRef)
    if (!credential) throw new Error('account credential is unavailable')
    if (!credential.expiresAt || Date.parse(credential.expiresAt) > this.now().getTime() + 60_000) return credential
    if (!credential.refreshToken) {
      await this.options.store.updateAccount(account.id, { status: 'interaction-required' })
      throw new Error('account interaction is required')
    }
    const pending = this.refreshes.get(account.id)
    if (pending) return pending.promise
    const controller = new AbortController()
    const promise = this.refreshCredential(account, provider, credential, controller.signal)
    const refresh = { promise, controller }
    this.refreshes.set(account.id, refresh)
    try {
      return await promise
    } finally {
      if (this.refreshes.get(account.id) === refresh) this.refreshes.delete(account.id)
    }
  }

  private async refreshCredential(
    account: ExtensionAccountRecord,
    provider: ExtensionProviderDefinition,
    current: ExtensionCredentialPayload,
    signal: AbortSignal
  ): Promise<ExtensionCredentialPayload> {
    const config = account.authType === 'oauth-pkce' ? provider.oauthPkce : provider.oauthDevice
    if (!config) throw new Error('provider refresh configuration is unavailable')
    try {
      const token = await this.tokenRequest(config.tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken!,
        client_id: config.clientId
      }, signal)
      const next = credentialFromToken({ ...token, refresh_token: token.refresh_token ?? current.refreshToken }, this.now())
      const latest = await this.options.store.getAccount(account.id)
      if (
        signal.aborted ||
        !latest ||
        latest.status !== 'connected' ||
        latest.credentialRef !== account.credentialRef
      ) throw new Error('account changed while credentials were refreshing')
      await this.options.credentials.set(account.credentialRef, next)
      const updated = await this.options.store.updateAccountIfCurrent(account.id, {
        status: 'connected',
        credentialRef: account.credentialRef
      }, {
        status: 'connected',
        ...(next.expiresAt ? { expiresAt: next.expiresAt } : {})
      })
      if (!updated || signal.aborted) {
        throw new Error('account changed while credentials were refreshing')
      }
      return next
    } catch (error) {
      if (!signal.aborted) {
        await this.options.store.updateAccountIfCurrent(account.id, {
          status: 'connected',
          credentialRef: account.credentialRef
        }, { status: 'interaction-required' })
      }
      throw error
    }
  }

  private async requireUsableAccount(
    principal: ExtensionPrincipal,
    accountId: string
  ): Promise<ExtensionAccountRecord> {
    const account = await this.options.store.getAccount(accountId)
    if (!account || account.ownerExtensionId !== principal.extensionId) throw new Error('account not found')
    if (account.status !== 'connected') throw new Error(`account is ${account.status}`)
    return account
  }

  private async requireProviderPermission(
    principal: ExtensionPrincipal,
    providerId: string,
    operation: 'use' | 'manage'
  ): Promise<ExtensionProviderDefinition> {
    const permission = `accounts.${operation}:${providerId}`
    if (!principal.permissions.includes(permission)) throw new Error(`Missing permission: ${permission}`)
    return this.options.store.requireOwnedProvider(principal, providerId)
  }

  private requireManage(principal: ExtensionPrincipal, providerId: string): void {
    const permission = `accounts.manage:${providerId}`
    if (!principal.permissions.includes(permission)) throw new Error(`Missing permission: ${permission}`)
  }

  private serializeAccountMutation<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.accountMutations.get(accountId) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const settled = run.then(() => undefined, () => undefined)
    this.accountMutations.set(accountId, settled)
    void settled.finally(() => {
      if (this.accountMutations.get(accountId) === settled) this.accountMutations.delete(accountId)
    })
    return run
  }

  private async tokenRequest(
    url: string,
    fields: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const response = await this.formRequest(url, fields, true, signal)
    if (typeof response.error === 'string') throw new Error(`OAuth token exchange failed: ${response.error}`)
    requiredString(response.access_token, 'access_token')
    return response
  }

  private async formRequest(
    url: string,
    fields: Record<string, string>,
    allowErrorBody = false,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(30_000)
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    const text = await readBoundedAuthenticationBody(response, 1024 * 1024)
    let parsed: unknown = {}
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = {}
    }
    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    if (!response.ok && !(allowErrorBody && typeof body.error === 'string')) {
      throw new Error(`provider authentication request failed (${response.status})`)
    }
    return body
  }

  private pruneTransactions(): void {
    const now = this.now().getTime()
    for (const [id, transaction] of this.pkce) if (transaction.expiresAt <= now) this.pkce.delete(id)
    for (const [id, transaction] of this.devices) if (transaction.expiresAt <= now) this.devices.delete(id)
  }

  private assertTransactionCapacity(extensionId: string): void {
    const all = [...this.pkce.values(), ...this.devices.values()]
    if (all.length >= this.maxGlobalPendingTransactions) {
      throw new Error('global account authorization transaction limit reached')
    }
    if (all.filter((transaction) => transaction.extensionId === extensionId).length >= this.maxPendingTransactions) {
      throw new Error('account authorization transaction limit reached')
    }
  }

  private async audit(
    principal: ExtensionPrincipal,
    operation: string,
    outcome: ExtensionAccountAuditEvent['outcome'],
    input: { providerId?: string; accountId?: string; details?: Record<string, unknown> }
  ): Promise<void> {
    await this.options.audit?.({
      timestamp: this.now().toISOString(),
      extensionId: principal.extensionId,
      operation,
      outcome,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.details ? { details: redactExtensionSecrets(input.details) as Record<string, unknown> } : {})
    })
  }
}

function injectCredential(
  headers: Headers,
  provider: ExtensionProviderDefinition,
  account: ExtensionAccountRecord,
  credential: ExtensionCredentialPayload
): void {
  if (account.authType === 'api-key') {
    if (!credential.apiKey) throw new Error('API-key credential is unavailable')
    headers.set(provider.apiKey?.headerName ?? 'Authorization', `${provider.apiKey?.prefix ?? 'Bearer '}${credential.apiKey}`)
    return
  }
  if (!credential.accessToken) throw new Error('OAuth access token is unavailable')
  headers.set('Authorization', `${credential.tokenType ?? 'Bearer'} ${credential.accessToken}`)
}

function credentialFromToken(token: Record<string, unknown>, now: Date): ExtensionCredentialPayload {
  const accessToken = requiredString(token.access_token, 'access_token')
  const expiresIn = boundedPositiveNumber(token.expires_in, 3_600, 365 * 24 * 60 * 60)
  return {
    accessToken,
    ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}),
    ...(typeof token.token_type === 'string' ? { tokenType: token.token_type } : { tokenType: 'Bearer' }),
    ...(typeof token.scope === 'string' ? { scope: token.scope } : {}),
    expiresAt: new Date(now.getTime() + expiresIn * 1_000).toISOString()
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64 * 1024) {
    throw new Error(`provider response is missing or exceeds the limit for ${name}`)
  }
  return value
}

function boundedPositiveNumber(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}

async function readBoundedAuthenticationBody(response: Response, maximum: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let retained = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (retained + next.value.byteLength > maximum) {
        await reader.cancel('Provider authentication response exceeded the limit').catch(() => undefined)
        throw new Error('provider authentication response exceeds 1 MiB')
      }
      chunks.push(Buffer.from(next.value))
      retained += next.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, retained).toString('utf8')
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return leftHash.equals(rightHash)
}

function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('operation cancelled'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('operation cancelled'))
    }, { once: true })
  })
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasNetworkPermission(permissions: readonly string[], hostnameInput: string): boolean {
  const hostname = hostnameInput.toLowerCase()
  return permissions.some((permission) => {
    if (!permission.startsWith('network:')) return false
    const pattern = permission.slice('network:'.length).toLowerCase()
    if (!pattern.startsWith('*.')) return hostname === pattern
    const suffix = pattern.slice(1)
    return hostname.endsWith(suffix) && hostname !== pattern.slice(2)
  })
}

function matchesHostnamePattern(patterns: readonly string[], hostnameInput: string): boolean {
  const hostname = hostnameInput.toLowerCase()
  return patterns.some((value) => {
    const pattern = value.toLowerCase()
    if (!pattern.startsWith('*.')) return hostname === pattern
    const suffix = pattern.slice(1)
    return hostname.endsWith(suffix) && hostname !== pattern.slice(2)
  })
}

function requestedScopes(declared: readonly string[], requested: readonly string[] | undefined): string[] {
  const effective = [...new Set(requested ?? declared)]
  if (effective.some((scope) => !declared.includes(scope))) {
    throw new Error('requested OAuth scope is not declared by the provider')
  }
  return effective
}

function redactCredentialResponseHeaders(response: Response, names: readonly string[]): Response {
  const headers = new Headers(response.headers)
  for (const name of names) headers.delete(name)
  const bodyless = response.body === null || [101, 103, 204, 205, 304].includes(response.status)
  return new Response(bodyless ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
