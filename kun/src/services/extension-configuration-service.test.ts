import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExtensionManifestSchema } from '@kun/extension-api'
import { ExtensionPaths } from '../extensions/paths.js'
import { ExtensionStateStore } from '../extensions/state-store.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionConfigurationConflictError,
  ExtensionConfigurationService
} from './extension-configuration-service.js'

const manifest = ExtensionManifestSchema.parse({
  manifestVersion: 1,
  apiVersion: '1.0.0',
  publisher: 'acme',
  name: 'settings',
  version: '1.0.0',
  engines: { kun: '*' },
  main: 'dist/main.mjs',
  activationEvents: ['onStartup'],
  contributes: {
    settings: [{
      id: 'general',
      title: 'General',
      scope: 'workspace',
      properties: {
        mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
        apiKey: { type: 'string' },
        accessToken: { type: 'string' },
        maxTokens: { type: 'integer', default: 512 }
      }
    }, {
      id: 'global',
      title: 'Global',
      scope: 'global',
      properties: { enabled: { type: 'boolean', default: false } }
    }]
  },
  permissions: ['ui.actions'],
  stateSchemaVersion: 0
})

describe('ExtensionConfigurationService', () => {
  it('persists declared values with workspace isolation, revisions, defaults, and conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-configuration-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'packages'),
        dataRoot: join(root, 'data')
      })
      const service = new ExtensionConfigurationService(new ExtensionStateStore(paths))
      const workspaceA = principal(join(root, 'workspace-a'))
      const workspaceB = principal(join(root, 'workspace-b'))
      await expect(service.get({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'mode'
      })).resolves.toBe('safe')

      const first = await service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'mode',
        value: 'fast',
        expectedRevision: 0
      })
      expect(first).toMatchObject({
        revision: 1,
        values: { 'extension:acme.settings/general': { mode: 'fast', limit: 3 } }
      })
      await expect(service.get({
        principal: workspaceB,
        manifest,
        sectionId: 'general',
        key: 'mode'
      })).resolves.toBe('safe')
      await expect(service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'limit',
        value: 11,
        expectedRevision: 1
      })).rejects.toThrow(/at most 10/)
      await expect(service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'limit',
        value: 4,
        expectedRevision: 0
      })).rejects.toBeInstanceOf(ExtensionConfigurationConflictError)
      await expect(service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'apiKey',
        value: 'must-not-store',
        expectedRevision: 1
      })).rejects.toThrow(/Account API/)
      await expect(service.get({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'apiKey'
      })).rejects.toThrow(/Account API/)
      await expect(service.keys({
        manifest,
        sectionId: 'general'
      })).resolves.toEqual(['limit', 'maxTokens', 'mode'])
      await expect(service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'accessToken',
        value: 'must-not-store',
        expectedRevision: 1
      })).rejects.toThrow(/Account API/)
      await expect(service.update({
        principal: workspaceA,
        manifest,
        sectionId: 'general',
        key: 'maxTokens',
        value: 1_024,
        expectedRevision: 1
      })).resolves.toMatchObject({ revision: 2 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function principal(workspaceRoot: string): ExtensionPrincipal {
  return {
    extensionId: 'acme.settings',
    extensionVersion: '1.0.0',
    permissions: ['ui.actions'],
    workspaceRoots: [workspaceRoot],
    workspaceTrusted: true
  }
}
