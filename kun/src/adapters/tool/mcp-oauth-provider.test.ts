import { describe, expect, it } from 'vitest'
import { defaultMcpOAuthRedirectPort } from './mcp-oauth-provider.js'

describe('defaultMcpOAuthRedirectPort', () => {
  it('maps a server identity to a stable private-range port', () => {
    const first = defaultMcpOAuthRedirectPort('docs', 'https://mcp.example.test')
    const repeated = defaultMcpOAuthRedirectPort('docs', 'https://mcp.example.test')
    const different = defaultMcpOAuthRedirectPort('issues', 'https://mcp.example.test')

    expect(repeated).toBe(first)
    expect(first).toBeGreaterThanOrEqual(49_152)
    expect(first).toBeLessThan(61_152)
    expect(different).not.toBe(first)
  })
})
