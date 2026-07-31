import { describe, expect, it } from 'vitest'
import { redactUrlForLog } from './compat-model-client.js'

describe('CompatModelClient log redaction', () => {
  it('removes URL userinfo and secret query values', () => {
    const redacted = redactUrlForLog('https://alice:supersecret@provider.example/v1?api_key=also-secret')
    expect(redacted).toBe('https://provider.example/v1?api_key=%5Bredacted%5D')
    expect(redacted).not.toContain('alice')
    expect(redacted).not.toContain('supersecret')
    expect(redacted).not.toContain('also-secret')
  })

  it('fails closed for malformed or adversarial URL text', () => {
    for (const value of [
      'not a url?api_key=also-secret',
      'https://alice:supersecret@ invalid.example/?token=also-secret',
      `${'&key'.repeat(20_000)}=also-secret`
    ]) {
      const redacted = redactUrlForLog(value)
      expect(redacted).toBe('[invalid URL]')
      expect(redacted).not.toContain('supersecret')
      expect(redacted).not.toContain('also-secret')
    }
  })
})
