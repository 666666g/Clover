import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionAccountBroker } from './extension-account-broker.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import {
  ExtensionProviderAccountStore,
  extensionProviderId
} from './extension-provider-account-store.js'

async function harness(fetchImpl?: typeof fetch) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-extension-accounts-'))
  const store = new ExtensionProviderAccountStore({
    dataDir,
    nowIso: () => '2026-07-11T00:00:00.000Z'
  })
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
  const audits: unknown[] = []
  const broker = new ExtensionAccountBroker({
    store,
    credentials,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    now: () => new Date('2026-07-11T00:00:00.000Z'),
    audit: (event) => { audits.push(event) }
  })
  return { dataDir, store, credentials, broker, audits }
}

function principal(localProviderId = 'cloud'): ExtensionPrincipal {
  const providerId = extensionProviderId('com.example.provider', localProviderId)
  return {
    extensionId: 'com.example.provider',
    extensionVersion: '1.0.0',
    permissions: [
      'providers.register',
      'accounts.read',
      `accounts.manage:${providerId}`,
      `accounts.use:${providerId}`,
      `accounts.secrets.read:${providerId}`,
      'network:api.example.com'
    ],
    workspaceRoots: ['/tmp/workspace'],
    workspaceTrusted: true
  }
}

async function registerProvider(
  store: ExtensionProviderAccountStore,
  owner = principal(),
  localId = 'cloud',
  endpoints: {
    pkceTokenUrl?: string
    deviceAuthorizationUrl?: string
    deviceTokenUrl?: string
  } = {}
) {
  return store.registerProvider(owner, {
    id: localId,
    displayName: 'Example Cloud',
    credentialHosts: ['api.example.com'],
    authTypes: ['api-key', 'oauth-pkce', 'oauth-device'],
    apiKey: { headerName: 'x-api-key', prefix: '' },
    oauthPkce: {
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: endpoints.pkceTokenUrl ?? 'https://auth.example.com/token',
      clientId: 'client-id',
      scopes: ['models.read'],
      redirectUri: 'http://127.0.0.1/oauth/callback'
    },
    oauthDevice: {
      deviceAuthorizationUrl: endpoints.deviceAuthorizationUrl ?? 'https://auth.example.com/device',
      tokenUrl: endpoints.deviceTokenUrl ?? 'https://auth.example.com/token',
      clientId: 'client-id',
      scopes: ['models.read']
    },
    capabilities: {
      streaming: true,
      toolCalls: true,
      reasoning: true,
      images: true,
      documents: true,
      tokenCounting: true
    }
  })
}

describe('ExtensionAccountBroker', () => {
  it('stores API keys only through protected input and returns redacted account projections', async () => {
    const h = await harness()
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    await expect(h.broker.createApiKeyAccount({
      principal: owner,
      providerId: provider.id,
      label: 'Primary',
      apiKey: 'sk-secret-key',
      protectedInput: false
    })).rejects.toThrow(/protected/)

    const account = await h.broker.createApiKeyAccount({
      principal: owner,
      providerId: provider.id,
      label: 'Primary',
      apiKey: 'sk-secret-key',
      protectedInput: true
    })
    expect(account).not.toHaveProperty('credentialRef')
    await expect(h.broker.listAccounts(owner, provider.id)).resolves.toEqual([
      expect.objectContaining({ id: account.id, label: 'Primary', status: 'connected' })
    ])
    const accountsFile = await readFile(join(h.dataDir, 'extensions', 'accounts.json'), 'utf8')
    expect(accountsFile).not.toContain('sk-secret-key')
  })

  it('renames and atomically replaces API-key credentials without changing the account reference', async () => {
    const h = await harness()
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const account = await h.broker.createApiKeyAccount({
      principal: owner,
      providerId: provider.id,
      label: 'Primary',
      apiKey: 'old-secret-key',
      protectedInput: true
    })
    const before = await h.store.getAccount(account.id)

    const renamed = await h.broker.renameAccount({
      principal: owner,
      accountId: account.id,
      label: 'Work account'
    })
    expect(renamed).toMatchObject({ id: account.id, label: 'Work account' })
    await expect(h.broker.replaceApiKeyAccount({
      principal: owner,
      accountId: account.id,
      apiKey: 'rejected-unprotected-key',
      protectedInput: false
    })).rejects.toThrow(/protected/)

    const replaced = await h.broker.replaceApiKeyAccount({
      principal: owner,
      accountId: account.id,
      apiKey: 'new-secret-key',
      protectedInput: true
    })
    const after = await h.store.getAccount(account.id)
    expect(replaced).toMatchObject({ id: account.id, label: 'Work account', status: 'connected' })
    expect(after?.credentialRef).toBe(before?.credentialRef)
    await expect(h.credentials.get(after!.credentialRef)).resolves.toEqual({ apiKey: 'new-secret-key' })
    const accountsFile = await readFile(join(h.dataDir, 'extensions', 'accounts.json'), 'utf8')
    expect(accountsFile).not.toContain('old-secret-key')
    expect(accountsFile).not.toContain('new-secret-key')
    expect(h.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'account.rename', outcome: 'allowed', accountId: account.id }),
      expect.objectContaining({ operation: 'account.replace.api-key', outcome: 'allowed', accountId: account.id })
    ]))
  })

  it('injects credentials in authenticated fetch without accepting an override', async () => {
    const captured: Array<{
      url: string
      authorization: string | null
      apiKey: string | null
      redirect: RequestInit['redirect']
    }> = []
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      captured.push({
        url: String(input),
        authorization: headers.get('authorization'),
        apiKey: headers.get('x-api-key'),
        redirect: init?.redirect
      })
      return new Response('ok', {
        status: 200,
        headers: {
          'x-api-key': 'response-secret',
          'set-cookie': 'session=response-secret',
          'x-request-id': 'safe-id'
        }
      })
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const account = await h.broker.createApiKeyAccount({
      principal: owner, providerId: provider.id, label: 'Primary', apiKey: 'sk-secret-key', protectedInput: true
    })

    const response = await h.broker.authenticatedFetch({
      principal: owner,
      accountId: account.id,
      url: 'https://api.example.com/models'
    })
    expect(response.headers.get('x-api-key')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-request-id')).toBe('safe-id')
    expect(captured).toEqual([{
      url: 'https://api.example.com/models',
      authorization: null,
      apiKey: 'sk-secret-key',
      redirect: 'manual'
    }])
    await expect(h.broker.authenticatedFetch({
      principal: owner,
      accountId: account.id,
      url: 'https://api.example.com/models',
      init: { headers: { 'x-api-key': 'attacker' } }
    })).rejects.toThrow(/override/)
    await expect(h.broker.authenticatedFetch({
      principal: {
        ...owner,
        permissions: [...owner.permissions, 'network:other.example.com']
      },
      accountId: account.id,
      url: 'https://other.example.com/collect'
    })).rejects.toThrow(/not allowed for host/)
  })

  it('validates PKCE state, exchanges tokens, and keeps callbacks single-use', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ''))
      expect(body.get('code_verifier')).toBeTruthy()
      return Response.json({
        access_token: 'oauth-access-secret',
        refresh_token: 'oauth-refresh-secret',
        token_type: 'Bearer',
        expires_in: 3600
      })
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    await expect(h.broker.beginPkceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'Invalid scope',
      scopes: ['admin']
    })).rejects.toThrow(/scope is not declared/)
    const started = await h.broker.beginPkceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'OAuth',
      scopes: ['models.read']
    })
    const state = new URL(started.authorizationUrl).searchParams.get('state')!

    await expect(h.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state: 'wrong-state',
      code: 'code',
      protectedCallback: true
    })).rejects.toThrow(/state/)
    const account = await h.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state,
      code: 'code',
      protectedCallback: true
    })
    expect(account).toMatchObject({ authType: 'oauth-pkce', status: 'connected' })
    await expect(h.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state,
      code: 'code',
      protectedCallback: true
    })).rejects.toThrow(/missing, expired, or already consumed/)
  })

  it('applies production DNS/address policy to OAuth device and token endpoints', async () => {
    const owner = principal()

    const pkce = await harness()
    const pkceProvider = await registerProvider(pkce.store, owner, 'cloud', {
      pkceTokenUrl: 'https://127.0.0.1/token'
    })
    const started = await pkce.broker.beginPkceAuthorization({
      principal: owner,
      providerId: pkceProvider.id,
      label: 'Blocked OAuth endpoint'
    })
    await expect(pkce.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state: new URL(started.authorizationUrl).searchParams.get('state')!,
      code: 'code',
      protectedCallback: true
    })).rejects.toThrow(/blocked loopback address/)

    const device = await harness()
    const deviceProvider = await registerProvider(device.store, owner, 'cloud', {
      deviceAuthorizationUrl: 'https://169.254.169.254/device'
    })
    await expect(device.broker.beginDeviceAuthorization({
      principal: owner,
      providerId: deviceProvider.id,
      label: 'Blocked device endpoint'
    })).rejects.toThrow(/blocked linkLocal address/)
  })

  it('completes a device-code flow without exposing the device credential', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/device')) {
        return Response.json({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.com/verify',
          expires_in: 600,
          interval: 1
        })
      }
      return Response.json({
        access_token: 'device-access-secret',
        refresh_token: 'device-refresh-secret',
        token_type: 'Bearer',
        expires_in: 3600
      })
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const started = await h.broker.beginDeviceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'Device account'
    })
    expect(started).toMatchObject({
      status: 'interaction-required',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.example.com/verify'
    })
    expect(started).not.toHaveProperty('deviceCode')
    await expect(h.broker.completeDeviceAuthorization({
      principal: owner,
      transactionId: started.transactionId
    })).resolves.toMatchObject({ authType: 'oauth-device', status: 'connected' })
  })

  it('serializes refresh and reuses the refreshed token for concurrent authenticated fetches', async () => {
    let tokenRequests = 0
    let refreshRequests = 0
    const authorizations: Array<string | null> = []
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/token')) {
        tokenRequests += 1
        const body = new URLSearchParams(String(init?.body ?? ''))
        if (body.get('grant_type') === 'refresh_token') {
          refreshRequests += 1
          await Promise.resolve()
          return Response.json({
            access_token: 'refreshed-access',
            refresh_token: 'refresh-secret',
            token_type: 'Bearer',
            expires_in: 3600
          })
        }
        return Response.json({
          access_token: 'expired-access',
          refresh_token: 'refresh-secret',
          token_type: 'Bearer',
          expires_in: 1
        })
      }
      authorizations.push(new Headers(init?.headers).get('authorization'))
      return new Response('ok')
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const started = await h.broker.beginPkceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'Refresh account'
    })
    const state = new URL(started.authorizationUrl).searchParams.get('state')!
    const account = await h.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state,
      code: 'code',
      protectedCallback: true
    })
    await Promise.all([
      h.broker.authenticatedFetch({
        principal: owner,
        accountId: account.id,
        url: 'https://api.example.com/models'
      }),
      h.broker.authenticatedFetch({
        principal: owner,
        accountId: account.id,
        url: 'https://api.example.com/models'
      })
    ])
    expect(tokenRequests).toBe(2)
    expect(refreshRequests).toBe(1)
    expect(authorizations).toEqual(['Bearer refreshed-access', 'Bearer refreshed-access'])
  })

  it('does not let a late credential refresh resurrect an account being deleted', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body ?? ''))
        return Response.json(body.get('grant_type') === 'refresh_token'
          ? {
              access_token: 'late-refreshed-access',
              refresh_token: 'refresh-secret',
              token_type: 'Bearer',
              expires_in: 3600
            }
          : {
              access_token: 'expired-access',
              refresh_token: 'refresh-secret',
              token_type: 'Bearer',
              expires_in: 1
            })
      }
      return new Response('must-not-reach-upstream')
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const started = await h.broker.beginPkceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'Refresh/delete race'
    })
    const account = await h.broker.completePkceAuthorization({
      principal: owner,
      transactionId: started.transactionId,
      state: new URL(started.authorizationUrl).searchParams.get('state')!,
      code: 'code',
      protectedCallback: true
    })
    const credentialRef = (await h.store.getAccount(account.id))!.credentialRef
    const originalSet = h.credentials.set.bind(h.credentials)
    let releaseRefreshWrite!: () => void
    const refreshWriteGate = new Promise<void>((resolvePromise) => {
      releaseRefreshWrite = resolvePromise
    })
    let refreshWriteStarted = false
    vi.spyOn(h.credentials, 'set').mockImplementation(async (reference, payload) => {
      if (payload.accessToken === 'late-refreshed-access') {
        refreshWriteStarted = true
        await refreshWriteGate
      }
      await originalSet(reference, payload)
    })

    const fetching = h.broker.authenticatedFetch({
      principal: owner,
      accountId: account.id,
      url: 'https://api.example.com/models'
    })
    await vi.waitFor(() => expect(refreshWriteStarted).toBe(true))
    const deleting = h.broker.deleteAccount(owner, account.id)
    await vi.waitFor(async () => {
      expect((await h.store.getAccount(account.id))?.status).toBe('unavailable')
    })
    releaseRefreshWrite()

    await expect(fetching).rejects.toThrow(/account changed|aborted/)
    await expect(deleting).resolves.toBe(true)
    await expect(h.store.getAccount(account.id)).resolves.toBeNull()
    await expect(h.credentials.get(credentialRef)).resolves.toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not persist a device credential after an accepted cancellation', async () => {
    let resolveToken!: (response: Response) => void
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.endsWith('/device')) {
        return Response.json({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.com/verify',
          expires_in: 600,
          interval: 1
        })
      }
      return new Promise<Response>((resolve) => { resolveToken = resolve })
    }) as unknown as typeof fetch
    const h = await harness(fetchImpl)
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const started = await h.broker.beginDeviceAuthorization({
      principal: owner,
      providerId: provider.id,
      label: 'Cancelled device account'
    })
    const completing = h.broker.completeDeviceAuthorization({
      principal: owner,
      transactionId: started.transactionId
    })
    await vi.waitFor(() => expect(resolveToken).toBeTypeOf('function'))
    expect(h.broker.cancelAuthorization(owner, started.transactionId)).toBe(true)
    resolveToken(Response.json({
      access_token: 'must-not-be-persisted',
      token_type: 'Bearer',
      expires_in: 3600
    }))
    await expect(completing).rejects.toThrow(/cancelled/)
    await expect(h.broker.listAccounts(owner, provider.id)).resolves.toEqual([])
  })

  it('enforces binding ownership and separately audited secret reveal consent', async () => {
    const h = await harness()
    const owner = principal()
    const provider = await registerProvider(h.store, owner)
    const account = await h.broker.createApiKeyAccount({
      principal: owner, providerId: provider.id, label: 'Primary', apiKey: 'secret', protectedInput: true
    })
    await expect(h.broker.revealSecret({
      principal: owner,
      accountId: account.id,
      nodeHost: true,
      protectedConsent: false,
      operation: 'sign-request'
    })).rejects.toThrow(/protected consent/)
    await expect(h.broker.revealSecret({
      principal: owner,
      accountId: account.id,
      nodeHost: true,
      protectedConsent: true,
      operation: 'sign-request'
    })).resolves.toEqual({ apiKey: 'secret' })
    expect(h.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'account.secret.reveal', outcome: 'denied' }),
      expect.objectContaining({ operation: 'account.secret.reveal', outcome: 'allowed' })
    ]))
  })
})
