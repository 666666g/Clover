import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AccountSessionCard,
  ExtensionAccountManagement,
  extensionAccountProviders,
  safeAccountVerificationUrl
} from './ExtensionAccountManagement'
import type { ExtensionManagementVersion } from './extension-workbench-client'

function version(
  grantedPermissions: string[] = ['accounts.read', 'accounts.manage:acme-models']
): ExtensionManagementVersion {
  return {
    id: 'acme.sample',
    version: '1.0.0',
    source: { type: 'archive' },
    requestedPermissions: [...grantedPermissions],
    grantedPermissions,
    apiVersion: '1.0.0',
    manifestVersion: 1,
    stateSchemaVersion: 1,
    mutable: false,
    modelProviders: [{
      id: 'acme-models',
      displayName: 'Acme Models',
      authenticationProviderId: 'acme-oauth',
      credentialHosts: [],
      adapterApiVersion: '1.0.0',
      models: []
    }],
    authentication: [{
      id: 'acme-oauth',
      displayName: 'Acme OAuth',
      type: 'oauth2-pkce',
      clientId: 'public-client',
      redirectUri: 'http://127.0.0.1:41234/callback',
      authorizationUrl: 'https://auth.example.test/authorize',
      tokenUrl: 'https://auth.example.test/token',
      scopes: ['models.read']
    }]
  }
}

describe('extension account management', () => {
  it('requires redacted account read permission and matching Provider/auth metadata', () => {
    expect(extensionAccountProviders(version())).toMatchObject([{
      provider: { id: 'acme-models' },
      authentication: { id: 'acme-oauth' },
      canRead: true,
      canManage: true
    }])
    expect(extensionAccountProviders(
      version(['accounts.read', 'accounts.use:acme-models'])
    )).toMatchObject([{ canRead: true, canManage: false }])
    expect(extensionAccountProviders(
      version(['accounts.manage:acme-models'])
    )).toMatchObject([{ canRead: false, canManage: true }])
    expect(extensionAccountProviders(
      version(['accounts.use:acme-models'])
    )).toEqual([])
    expect(extensionAccountProviders({
      ...version(),
      authentication: []
    })).toEqual([])
  })

  it('renders only the host account surface for eligible extensions', () => {
    const eligible = renderToStaticMarkup(createElement(ExtensionAccountManagement, {
      extensionId: 'acme.sample',
      version: version(),
      workspaceRoot: '/workspace',
      disabled: false,
      copy: (_zh: string, en: string) => en
    }))
    expect(eligible).toContain('Provider accounts')
    expect(eligible).toContain('Only redacted account metadata')
    expect(eligible).toContain('Start protected authorization')
    expect(eligible).not.toContain('type="password"')

    const manageOnly = renderToStaticMarkup(createElement(ExtensionAccountManagement, {
      extensionId: 'acme.sample',
      version: version(['accounts.manage:acme-models']),
      workspaceRoot: '/workspace',
      disabled: false,
      copy: (_zh: string, en: string) => en
    }))
    expect(manageOnly).toContain('has no accounts.read grant')
    expect(manageOnly).toContain('Start protected authorization')

    const ineligible = renderToStaticMarkup(createElement(ExtensionAccountManagement, {
      extensionId: 'acme.sample',
      version: version([]),
      workspaceRoot: '/workspace',
      disabled: false,
      copy: (_zh: string, en: string) => en
    }))
    expect(ineligible).toBe('')
  })

  it('shows PKCE completion only through the protected callback flow and device status separately', () => {
    const common = {
      disabled: false,
      copy: (_zh: string, en: string) => en,
      onComplete: () => undefined,
      onRefresh: () => undefined,
      onCancel: () => undefined
    }
    const oauth = renderToStaticMarkup(createElement(AccountSessionCard, {
      ...common,
      authenticationType: 'oauth2-pkce',
      session: {
        id: 'oauth-session',
        status: 'pending',
        verificationUrl: 'https://auth.example.test/authorize',
        expiresAt: '2026-07-11T00:10:00.000Z'
      }
    }))
    expect(oauth).toContain('Verification URL')
    expect(oauth).toContain('Complete OAuth callback in protected window')
    expect(oauth).not.toContain('callback URL')
    expect(oauth).not.toContain('name="code"')

    const device = renderToStaticMarkup(createElement(AccountSessionCard, {
      ...common,
      authenticationType: 'device-code',
      session: {
        id: 'device-session',
        status: 'pending',
        verificationUrl: 'https://auth.example.test/device',
        userCode: 'ABCD-EFGH'
      }
    }))
    expect(device).toContain('User code')
    expect(device).toContain('ABCD-EFGH')
    expect(device).not.toContain('Complete OAuth callback')
  })

  it('opens only HTTPS or loopback HTTP verification URLs', () => {
    expect(safeAccountVerificationUrl('https://auth.example.test/device')).toBe(
      'https://auth.example.test/device'
    )
    expect(safeAccountVerificationUrl('http://127.0.0.1:41234/callback')).toBe(
      'http://127.0.0.1:41234/callback'
    )
    expect(safeAccountVerificationUrl('http://auth.example.test/device')).toBeNull()
    expect(safeAccountVerificationUrl('javascript:alert(1)')).toBeNull()
  })
})
