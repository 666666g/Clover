import { describe, expect, it } from 'vitest'
import { ExtensionSecretRevealConsentService } from './extension-secret-reveal-consent.js'

const principal = {
  extensionId: 'acme.provider',
  extensionVersion: '1.0.0',
  permissions: ['accounts.secrets.read:models'],
  workspaceRoots: [],
  workspaceTrusted: false
}

describe('ExtensionSecretRevealConsentService', () => {
  it('binds a one-shot decision to the pending operation without secret material', async () => {
    const service = new ExtensionSecretRevealConsentService()
    const authorization = service.authorize({
      principal,
      accountId: 'account_1',
      operation: 'sign webhook request'
    })
    const [request] = service.list()
    expect(request).toMatchObject({
      extensionId: 'acme.provider',
      extensionVersion: '1.0.0',
      accountId: 'account_1',
      operation: 'sign webhook request'
    })
    expect(request).not.toHaveProperty('secret')
    expect(service.decide(request!.id, 'allow')).toBe(true)
    await expect(authorization).resolves.toBe(true)
    expect(service.decide(request!.id, 'allow')).toBe(false)
  })

  it('fails closed on cancellation and bounds requests per extension', async () => {
    const service = new ExtensionSecretRevealConsentService({ maximumPerExtension: 1 })
    const controller = new AbortController()
    const first = service.authorize({
      principal,
      accountId: 'account_1',
      operation: 'first',
      signal: controller.signal
    })
    await expect(service.authorize({
      principal,
      accountId: 'account_2',
      operation: 'second'
    })).resolves.toBe(false)
    controller.abort()
    await expect(first).resolves.toBe(false)
    expect(service.list()).toEqual([])
  })
})
