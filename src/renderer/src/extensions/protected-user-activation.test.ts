import { describe, expect, it, vi } from 'vitest'
import { runTrustedUserActivation } from './protected-user-activation'

describe('protected user activation', () => {
  it('rejects HTMLElement.click()/dispatchEvent style synthetic approvals', () => {
    const action = vi.fn()
    expect(runTrustedUserActivation({ isTrusted: false }, action)).toBe(false)
    expect(action).not.toHaveBeenCalled()
  })

  it('allows a real Chromium user activation to enter the protected Main flow', () => {
    const action = vi.fn()
    expect(runTrustedUserActivation({ isTrusted: true }, action)).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
  })
})
