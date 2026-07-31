import { get as httpGet } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelGrokBrowserAuth,
  encodeGrokCredentials,
  ensureFreshGrokCredentials,
  GROK_CLIENT_VERSION,
  GROK_EARLY_INVALIDATION_MS,
  GROK_OAUTH_CLIENT_ID,
  GROK_OAUTH_ISSUER,
  isGrokCredentialExpired,
  isGrokOAuthCredentials,
  parseGrokCredentials,
  parseGrokPastedAuthInput,
  resolveGrokOAuthApiKey,
  startGrokBrowserAuth,
  submitGrokBrowserAuthCode
} from './grok-auth'

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

function successfulTokenBody(overrides: Record<string, unknown> = {}) {
  const claims = { email: 'grok@example.com', sub: 'user_123' }
  return {
    access_token: encodeJwt(claims),
    refresh_token: 'refresh-token',
    id_token: encodeJwt(claims),
    expires_in: 3600,
    ...overrides
  }
}

function discoveryBody() {
  return {
    authorization_endpoint: `${GROK_OAUTH_ISSUER}/oauth2/auth`,
    token_endpoint: `${GROK_OAUTH_ISSUER}/oauth2/token`
  }
}

function hitCallback(redirectUri: string, state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUri)
    url.searchParams.set('code', 'auth-code')
    url.searchParams.set('state', state)
    const req = httpGet(url, (res) => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('error', reject)
  })
}

function mockDiscoveryAndToken(tokenBody: Record<string, unknown> = successfulTokenBody()) {
  const tokenRequests: Array<{ url: string; body: string; clientVersion: string | null }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlString = String(url)
    if (urlString.includes('openid-configuration')) {
      return new Response(JSON.stringify(discoveryBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    tokenRequests.push({
      url: urlString,
      body: String(init?.body ?? ''),
      clientVersion: new Headers(init?.headers).get('x-grok-client-version')
    })
    return new Response(JSON.stringify(tokenBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })
  return tokenRequests
}

afterEach(() => {
  cancelGrokBrowserAuth()
  vi.restoreAllMocks()
})

describe('startGrokBrowserAuth', () => {
  it('completes browser OAuth via loopback callback', async () => {
    const tokenRequests = mockDiscoveryAndToken()
    let authUrlString = ''
    const result = await startGrokBrowserAuth(async (url) => {
      authUrlString = url
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        kind: 'grok-oauth',
        email: 'grok@example.com',
        userId: 'user_123',
        refreshToken: 'refresh-token'
      }
    })
    const authUrl = new URL(authUrlString)
    expect(authUrl.searchParams.get('client_id')).toBe(GROK_OAUTH_CLIENT_ID)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    const tokenBody = new URLSearchParams(tokenRequests[0]?.body ?? '')
    const verifier = tokenBody.get('code_verifier') ?? ''
    expect(verifier).toHaveLength(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokenRequests[0]?.clientVersion).toBe(GROK_CLIENT_VERSION)
  })

  it('completes browser OAuth when the user pastes a bare authorization code', async () => {
    const tokenRequests = mockDiscoveryAndToken()
    const browserPromise = startGrokBrowserAuth(async () => {
      // Wait until the pending session is ready, then paste.
      await vi.waitFor(async () => {
        const result = await submitGrokBrowserAuthCode('pasted-auth-code')
        expect(result.ok).toBe(true)
      })
    })

    const result = await browserPromise
    expect(result).toMatchObject({
      ok: true,
      credentials: { kind: 'grok-oauth', email: 'grok@example.com' }
    })
    if (result.ok) expect(result.credentials.accessToken).not.toBe('pasted-auth-code')
    const tokenBody = new URLSearchParams(tokenRequests[0]?.body ?? '')
    expect(tokenBody.get('code')).toBe('pasted-auth-code')
    expect(tokenBody.get('grant_type')).toBe('authorization_code')
  })

  it('includes token endpoint error details when the exchange is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url)
      if (urlString.includes('openid-configuration')) {
        return new Response(JSON.stringify(discoveryBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response(
        JSON.stringify({
          error: 'access_denied',
          error_description: 'team disallowed'
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    })

    const result = await startGrokBrowserAuth(async (url) => {
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toContain('returned 403: access_denied: team disallowed')
    }
  })
})

describe('parseGrokPastedAuthInput', () => {
  it('accepts bare codes and callback URLs', () => {
    expect(parseGrokPastedAuthInput('  abc123  ')).toEqual({ code: 'abc123', state: '' })
    expect(
      parseGrokPastedAuthInput('http://127.0.0.1:1234/callback?code=xyz&state=st')
    ).toEqual({ code: 'xyz', state: 'st' })
  })
})

describe('credential helpers and refresh', () => {
  it('round-trips encode/parse and materializes proxy headers', () => {
    const encoded = encodeGrokCredentials({
      kind: 'grok-oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      email: 'a@b.c',
      userId: 'u1'
    })
    expect(isGrokOAuthCredentials(encoded)).toBe(true)
    expect(parseGrokCredentials(encoded)?.email).toBe('a@b.c')
    expect(resolveGrokOAuthApiKey(encoded)).toEqual({
      apiKey: 'access',
      headers: {
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-authenticateresponse': 'authenticate-response',
        'x-grok-client-version': GROK_CLIENT_VERSION,
        'x-grok-client-mode': 'interactive'
      }
    })
    expect(resolveGrokOAuthApiKey('plain-key')).toEqual({ apiKey: 'plain-key' })
  })

  it('marks credentials expired inside the early-invalidation window', () => {
    const now = 1_000_000_000
    expect(
      isGrokCredentialExpired(
        {
          kind: 'grok-oauth',
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: now + GROK_EARLY_INVALIDATION_MS - 1
        },
        GROK_EARLY_INVALIDATION_MS,
        now
      )
    ).toBe(true)
    expect(
      isGrokCredentialExpired(
        {
          kind: 'grok-oauth',
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: now + GROK_EARLY_INVALIDATION_MS + 10_000
        },
        GROK_EARLY_INVALIDATION_MS,
        now
      )
    ).toBe(false)
  })

  it('refreshes credentials that fall within the early-invalidation window', async () => {
    const newClaims = { email: 'new@example.com', sub: 'user_new' }
    const tokenRequests = mockDiscoveryAndToken(
      successfulTokenBody({
        access_token: encodeJwt(newClaims),
        id_token: encodeJwt(newClaims),
        refresh_token: 'new-refresh',
        expires_in: 7200
      })
    )
    const raw = encodeGrokCredentials({
      kind: 'grok-oauth',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() + 60_000,
      email: 'old@example.com',
      userId: 'user_old',
      issuer: GROK_OAUTH_ISSUER,
      clientId: GROK_OAUTH_CLIENT_ID
    })
    const result = await ensureFreshGrokCredentials(raw)
    expect(result.refreshed).toBe(true)
    expect(result.credentials?.accessToken).not.toBe('old-access')
    expect(result.credentials?.refreshToken).toBe('new-refresh')
    expect(parseGrokCredentials(result.apiKey)?.email).toBe('new@example.com')
    expect(tokenRequests[0]?.clientVersion).toBe(GROK_CLIENT_VERSION)
  })
})
