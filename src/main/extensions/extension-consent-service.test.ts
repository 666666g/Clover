import { describe, expect, it, vi } from 'vitest'
import {
  canonicalJson,
  ExtensionConsentError,
  ExtensionConsentTokenService,
  ProtectedExtensionActionService,
  type ExtensionConsentBinding
} from './extension-consent-service'

function binding(overrides: Partial<ExtensionConsentBinding> = {}): ExtensionConsentBinding {
  return {
    extensionId: 'acme.example',
    extensionVersion: '1.0.0',
    operationKind: 'extension.install',
    parameters: { path: '/tmp/example.kunx', permissions: ['ui.views'] },
    senderId: 12,
    protectedWindowSessionId: 'protected-window-1',
    ...overrides
  }
}

describe('ExtensionConsentTokenService', () => {
  it('authorizes the exact action once and rejects replay', () => {
    const service = new ExtensionConsentTokenService(() => 1_000, 10_000)
    const issued = service.issue(binding())

    expect(() => service.consume(issued.token, binding())).not.toThrow()
    expect(() => service.consume(issued.token, binding())).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_CONSENT_REPLAYED' })
    )
  })

  it('burns a token whose action parameters do not match', () => {
    const service = new ExtensionConsentTokenService(() => 1_000, 10_000)
    const issued = service.issue(binding())

    expect(() => service.consume(
      issued.token,
      binding({ parameters: { path: '/tmp/other.kunx', permissions: ['ui.views'] } })
    )).toThrowError(expect.objectContaining({ code: 'EXTENSION_CONSENT_MISMATCH' }))
    expect(() => service.consume(issued.token, binding())).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_CONSENT_REPLAYED' })
    )
  })

  it('rejects expired tokens without running the operation', () => {
    let now = 1_000
    const service = new ExtensionConsentTokenService(() => now, 100)
    const issued = service.issue(binding())
    now = 1_101

    expect(() => service.consume(issued.token, binding())).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_CONSENT_EXPIRED' })
    )
  })

  it('canonicalizes object key order and rejects non-JSON parameters', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}')
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/)
  })
})

describe('ProtectedExtensionActionService', () => {
  it('keeps the token internal and requires the sender-bound lookup handle', async () => {
    const prompt = vi.fn(async () => true)
    const service = new ProtectedExtensionActionService(
      new ExtensionConsentTokenService(() => 1_000, 10_000),
      prompt,
      () => 1_000
    )
    const actionBinding = {
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      operationKind: 'extension.enable',
      parameters: { extensionId: 'acme.example' },
      senderId: 7
    }
    const authorization = await service.authorize(actionBinding, {
      title: 'Enable',
      message: 'Enable extension?'
    })
    expect(authorization).toMatchObject({ approved: true })
    if (!authorization.approved) throw new Error('expected approval')
    expect(authorization).not.toHaveProperty('token')

    expect(() => service.consume(authorization.requestId, {
      ...actionBinding,
      senderId: 8
    })).toThrowError(ExtensionConsentError)
  })
})
