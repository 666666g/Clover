import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { modelClientDiagnostics, sanitizeProviderBaseUrl } from './model-client-diagnostics.js'

class DiagnosticModel implements ModelClient {
  readonly provider = 'compat-multi'
  readonly model = 'default-model'
  readonly config = {
    baseUrl: 'https://default.example/v1',
    endpointFormat: 'chat_completions',
    model: 'default-model'
  }

  configFor(providerId?: string) {
    if (providerId === 'missing') throw new Error('unknown model provider: missing')
    return this.config
  }

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('modelClientDiagnostics', () => {
  it('does not throw or substitute default endpoint details for an unknown explicit provider', () => {
    expect(modelClientDiagnostics(new DiagnosticModel(), 'missing')).toEqual({
      provider: 'compat-multi'
    })
  })

  it('fails closed instead of leaking malformed provider URL fragments', () => {
    for (const value of [
      'not a url?api_key=also-secret',
      'https://alice:supersecret@ invalid.example/#also-secret',
      `${'#'.repeat(20_000)}also-secret`
    ]) {
      const sanitized = sanitizeProviderBaseUrl(value)
      expect(sanitized).toBe('[invalid URL]')
      expect(sanitized).not.toContain('supersecret')
      expect(sanitized).not.toContain('also-secret')
    }
  })
})
