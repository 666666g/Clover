import { resolveCodexOAuthApiKey } from './codex-auth'

const CODEX_RESPONSES_ENDPOINT = 'chatgpt.com/backend-api/codex'

export function isCodexResponsesEndpoint(baseUrl: string): boolean {
  return baseUrl.includes(CODEX_RESPONSES_ENDPOINT)
}

export function resolveCodexResponsesRequestAuth(baseUrl: string, rawApiKey: string): {
  apiKey: string
  headers: Record<string, string>
} {
  if (!isCodexResponsesEndpoint(baseUrl)) {
    return { apiKey: rawApiKey.trim(), headers: {} }
  }
  const resolved = resolveCodexOAuthApiKey(rawApiKey)
  if (rawApiKey.trim().startsWith('{') && resolved.apiKey === rawApiKey.trim()) {
    return { apiKey: '', headers: {} }
  }
  return { apiKey: resolved.apiKey, headers: resolved.headers ?? {} }
}

export function usesCodexResponsesLite(baseUrl: string, responsesMode?: 'lite'): boolean {
  return isCodexResponsesEndpoint(baseUrl) && responsesMode === 'lite'
}

export function codexResponsesLiteInput(
  systemPrompt: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[] = []
): Record<string, unknown>[] {
  return [
    { type: 'additional_tools', role: 'developer', tools },
    ...(systemPrompt.trim()
      ? [{
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: systemPrompt }]
        }]
      : []),
    ...input
  ]
}

export function withCodexResponsesLiteHeader(
  headers: Record<string, string>,
  responsesLite: boolean
): Record<string, string> {
  return responsesLite
    ? { ...headers, 'x-openai-internal-codex-responses-lite': 'true' }
    : headers
}
