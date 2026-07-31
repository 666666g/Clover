export function bearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

export function isAuthorized(headers: Headers, expectedToken: string, insecure = false): boolean {
  if (insecure) return true
  return expectedToken.length > 0 && bearerToken(headers) === expectedToken
}

/** Sensitive control planes remain token-bound even when general HTTP auth is disabled. */
export function isRuntimeTokenAuthorized(headers: Headers, expectedToken: string): boolean {
  return expectedToken.length > 0 && bearerToken(headers) === expectedToken
}
