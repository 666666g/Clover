import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ExtensionStateMigrationCoordinator,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateStore,
  parseExtensionManifest,
  type ExtensionManager,
  type InstalledExtensionVersion,
  type ResolvedExtension,
  type VersionSwitchContext
} from '../src/extensions/index.js'

describe('extension state store', () => {
  it('isolates global/workspace state and migrates every namespace transactionally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      const workspaceA = paths.workspaceKey(join(root, 'workspace-a'))
      const workspaceB = paths.workspaceKey(join(root, 'workspace-b'))
      await store.setGlobal('acme.demo', 'count', 1)
      await store.setWorkspace('acme.demo', workspaceA, 'name', 'A')
      await store.setWorkspace('acme.demo', workspaceB, 'name', 'B')
      await store.setGlobal('other.demo', 'count', 99)

      const migrated = await store.migrate('acme.demo', 1, async (from, to, state) => {
        expect({ from, to }).toEqual({ from: 0, to: 1 })
        return {
          global: { ...state.global, migrated: true },
          workspaces: Object.fromEntries(
            Object.entries(state.workspaces).map(([key, value]) => [key, { ...value, schema: to }])
          )
        }
      })
      expect(migrated.schemaVersion).toBe(1)
      expect(migrated.global).toMatchObject({ count: 1, migrated: true })
      expect(migrated.workspaces[workspaceA]).toEqual({ name: 'A', schema: 1 })
      expect(migrated.workspaces[workspaceB]).toEqual({ name: 'B', schema: 1 })
      expect(await store.getGlobal('other.demo', 'count')).toBe(99)

      const backups = await readdir(paths.backupsDirectory('acme.demo'))
      expect(backups.some((name) => name.includes('-schema-0-'))).toBe(true)
      const restored = await store.restoreCompatibleSnapshot('acme.demo', 0)
      expect(restored.schemaVersion).toBe(0)
      expect(restored.global).toEqual({ count: 1 })
      expect(restored.workspaces[workspaceA]).toEqual({ name: 'A' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains prior committed state when migration throws or times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-failure-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths, { migrationTimeoutMs: 20 })
      await store.setGlobal('acme.demo', 'safe', 'old')
      await expect(
        store.migrate('acme.demo', 1, async () => {
          throw new Error('bad migration')
        })
      ).rejects.toMatchObject({ code: 'EXTENSION_STATE_MIGRATION_FAILED' })
      expect(await store.read('acme.demo')).toMatchObject({
        schemaVersion: 0,
        global: { safe: 'old' }
      })

      await expect(
        store.migrate('acme.demo', 1, async (_from, _to, _state, signal) => {
          await new Promise<void>((resolvePromise) => {
            signal.addEventListener('abort', () => resolvePromise(), { once: true })
          })
          return { global: { unsafe: true }, workspaces: {} }
        })
      ).rejects.toMatchObject({
        code: 'EXTENSION_STATE_MIGRATION_FAILED',
        details: { from: 0, to: 1 }
      })
      expect(await store.getGlobal('acme.demo', 'safe')).toBe('old')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses inferred downgrades and reports unavailable versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-diagnostic-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      await store.migrate('acme.demo', 2, async () => ({ global: {}, workspaces: {} }))
      await expect(
        store.migrate('acme.demo', 1, async () => ({ global: {}, workspaces: {} }))
      ).rejects.toMatchObject({ code: 'EXTENSION_STATE_DOWNGRADE_FORBIDDEN' })

      await expect(
        store.diagnoseVersion('acme.demo', '1.0.0', [
          { version: '1.0.0', stateSchemaVersion: 1 },
          { version: '2.0.0', stateSchemaVersion: 2 }
        ])
      ).resolves.toMatchObject({
        available: false,
        code: 'EXTENSION_STATE_DOWNGRADE_FORBIDDEN',
        stateSchemaVersion: 2
      })
      await expect(
        store.diagnoseVersion('acme.demo', 'missing', [
          { version: '2.0.0', stateSchemaVersion: 2 }
        ])
      ).resolves.toMatchObject({
        available: false,
        code: 'EXTENSION_VERSION_UNAVAILABLE'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('coordinates host migrations before selection and restores state if selection fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-coordinator-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      await store.setGlobal('acme.demo', 'value', 'old')
      const manager = {
        deactivate: vi.fn(async () => undefined),
        migrateState: vi.fn(async (_extension, _from, to) => ({
          value: 'new',
          migratedTo: to
        }))
      } as unknown as ExtensionManager
      const registry = new ExtensionRegistry(paths)
      const coordinator = new ExtensionStateMigrationCoordinator(store, manager, registry)
      const context: VersionSwitchContext = {
        extensionId: 'acme.demo',
        from: resolvedForSchema(root, '1.0.0', 0),
        to: resolvedForSchema(root, '2.0.0', 1),
        reason: 'install'
      }
      const lifecycle = coordinator.lifecycle()
      await expect(lifecycle.runVersionSwitch!(context, async () => {
        throw new Error('registry failed')
      })).rejects.toThrow('registry failed')
      expect(manager.migrateState).toHaveBeenCalledOnce()
      expect(await store.read('acme.demo')).toMatchObject({
        schemaVersion: 0,
        global: { value: 'old' }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps host-owned state outside extension migration code and preserves it across upgrades', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-host-owned-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      const workspaceKey = paths.workspaceKey(join(root, 'workspace'))
      const configuration = {
        schemaVersion: 1,
        revision: 7,
        global: { general: { mode: 'safe' } },
        workspaces: {}
      }
      await store.setGlobal('acme.demo', 'value', 'old')
      await store.setGlobal('acme.demo', '__kun_configuration_document_v1', configuration)
      await store.setWorkspace('acme.demo', workspaceKey, 'visible', true)
      await store.setWorkspace('acme.demo', workspaceKey, '__kun_view_state_v1', { selected: 'result' })
      const migrateState = vi.fn(async (
        _extension: ResolvedExtension,
        _from: number,
        _to: number,
        state: unknown,
        options: { scope: 'global' | 'workspace' }
      ) => {
        expect(state).not.toHaveProperty('__kun_configuration_document_v1')
        expect(state).not.toHaveProperty('__kun_view_state_v1')
        return { ...(state as Record<string, unknown>), migratedScope: options.scope }
      })
      const manager = {
        deactivate: vi.fn(async () => undefined),
        migrateState
      } as unknown as ExtensionManager
      const coordinator = new ExtensionStateMigrationCoordinator(
        store,
        manager,
        new ExtensionRegistry(paths)
      )

      await coordinator.lifecycle().runVersionSwitch!({
        extensionId: 'acme.demo',
        from: resolvedForSchema(root, '1.0.0', 0),
        to: resolvedForSchema(root, '2.0.0', 1),
        reason: 'select'
      }, async () => undefined)

      expect(migrateState).toHaveBeenCalledTimes(2)
      expect(await store.read('acme.demo')).toMatchObject({
        schemaVersion: 1,
        global: {
          value: 'old',
          migratedScope: 'global',
          __kun_configuration_document_v1: configuration
        },
        workspaces: {
          [workspaceKey]: {
            visible: true,
            migratedScope: 'workspace',
            __kun_view_state_v1: { selected: 'result' }
          }
        }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects attempts by extension migration code to create host-owned state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-host-owned-injection-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      await store.setGlobal('acme.demo', 'value', 'old')
      const manager = {
        deactivate: vi.fn(async () => undefined),
        migrateState: vi.fn(async () => ({
          value: 'new',
          __kun_configuration_document_v1: { revision: 999 }
        }))
      } as unknown as ExtensionManager
      const coordinator = new ExtensionStateMigrationCoordinator(
        store,
        manager,
        new ExtensionRegistry(paths)
      )

      await expect(coordinator.lifecycle().runVersionSwitch!({
        extensionId: 'acme.demo',
        from: resolvedForSchema(root, '1.0.0', 0),
        to: resolvedForSchema(root, '2.0.0', 1),
        reason: 'select'
      }, async () => undefined)).rejects.toMatchObject({
        code: 'EXTENSION_STATE_MIGRATION_FAILED'
      })
      expect(await store.read('acme.demo')).toMatchObject({
        schemaVersion: 0,
        global: { value: 'old' }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not commit package selection when a coordinated migration times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-timeout-switch-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths, { migrationTimeoutMs: 20 })
      const registry = new ExtensionRegistry(paths)
      await store.setGlobal('acme.demo', 'safe', 'old')
      const manager = {
        deactivate: vi.fn(async () => undefined),
        migrateState: vi.fn(async (
          _extension,
          _from,
          _to,
          _state,
          options: { signal?: AbortSignal }
        ) => new Promise((resolvePromise, rejectPromise) => {
          options.signal?.addEventListener('abort', () => rejectPromise(new Error('aborted')), {
            once: true
          })
          void resolvePromise
        }))
      } as unknown as ExtensionManager
      const coordinator = new ExtensionStateMigrationCoordinator(store, manager, registry)
      const commit = vi.fn(async () => undefined)

      await expect(coordinator.lifecycle().runVersionSwitch!(
        {
          extensionId: 'acme.demo',
          from: resolvedForSchema(root, '1.0.0', 0),
          to: resolvedForSchema(root, '2.0.0', 1),
          reason: 'select'
        },
        commit
      )).rejects.toMatchObject({
        code: 'EXTENSION_STATE_MIGRATION_FAILED',
        details: { from: 0, to: 1 }
      })
      expect(commit).not.toHaveBeenCalled()
      expect(await store.read('acme.demo')).toMatchObject({
        schemaVersion: 0,
        global: { safe: 'old' }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('starts a fresh install at its declared schema and removes provisional state on commit failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-fresh-install-'))
    try {
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const store = new ExtensionStateStore(paths)
      const registry = new ExtensionRegistry(paths)
      const manager = {
        deactivate: vi.fn(async () => undefined),
        migrateState: vi.fn(async () => ({ shouldNotRun: true }))
      } as unknown as ExtensionManager
      const coordinator = new ExtensionStateMigrationCoordinator(store, manager, registry)

      await expect(coordinator.lifecycle().runVersionSwitch!(
        {
          extensionId: 'acme.demo',
          to: resolvedForSchema(root, '1.0.0', 1),
          reason: 'install'
        },
        async () => {
          throw new Error('registry unavailable')
        }
      )).rejects.toThrow('registry unavailable')

      expect(manager.migrateState).not.toHaveBeenCalled()
      await expect(access(join(paths.stateDirectory('acme.demo'), 'current.json')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    {
      registryCommitted: false,
      selectedVersion: '1.0.0',
      schemaVersion: 0,
      value: 'old',
      packageRetained: false
    },
    {
      registryCommitted: true,
      selectedVersion: '2.0.0',
      schemaVersion: 1,
      value: 'new',
      packageRetained: true
    }
  ])(
    'recovers a crash boundary with registryCommitted=$registryCommitted deterministically',
    async ({ registryCommitted, selectedVersion, schemaVersion, value, packageRetained }) => {
      const root = await mkdtemp(join(tmpdir(), 'kun-extension-state-crash-recovery-'))
      try {
        const paths = new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        })
        const store = new ExtensionStateStore(paths)
        const registry = new ExtensionRegistry(paths)
        await registry.registerVersion('acme.demo', installedRecord(paths, '1.0.0', 0))
        const v2 = installedRecord(paths, '2.0.0', 1)
        await mkdir(v2.packagePath, { recursive: true })
        await writeFile(join(v2.packagePath, 'main.mjs'), 'export async function activate() {}\n')
        if (process.platform !== 'win32') {
          await chmod(join(v2.packagePath, 'main.mjs'), 0o400)
        }
        await store.setGlobal('acme.demo', 'value', 'old')
        const target = { kind: 'installed' as const, version: '2.0.0' }
        const registryBefore = await registry.captureVersionSwitch('acme.demo', target)
        const transactionId = '11111111-2222-4333-8444-555555555555'
        const recovery = await store.runVersionSwitchTransaction('acme.demo', async (transaction) => {
          const current = await transaction.read()
          return transaction.createRecoverySnapshot(transactionId, current)
        })
        await store.migrate('acme.demo', 1, async () => ({
          global: { value: 'new' },
          workspaces: {}
        }))
        if (registryCommitted) await registry.registerVersion('acme.demo', v2)
        await writeFile(
          join(paths.stateDirectory('acme.demo'), 'version-switch.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            transactionId,
            extensionId: 'acme.demo',
            phase: 'state-prepared',
            reason: 'select',
            target,
            registryBefore,
            stateExistedBefore: true,
            fromStateSchema: 0,
            toStateSchema: 1,
            backupName: recovery.backupName,
            backupDigest: recovery.digest,
            startedAt: new Date().toISOString()
          }, null, 2)}\n`
        )

        const manager = { deactivate: vi.fn(async () => undefined) } as unknown as ExtensionManager
        const recovered = new ExtensionStateMigrationCoordinator(store, manager, registry)
        await recovered.recoverAll()

        expect((await registry.get('acme.demo'))?.selectedVersion).toBe(selectedVersion)
        expect(await store.read('acme.demo')).toMatchObject({
          schemaVersion,
          global: { value }
        })
        await expect(access(join(paths.stateDirectory('acme.demo'), 'version-switch.json')))
          .rejects.toMatchObject({ code: 'ENOENT' })
        if (packageRetained) {
          await expect(access(v2.packagePath)).resolves.toBeUndefined()
        } else {
          await expect(access(v2.packagePath)).rejects.toMatchObject({ code: 'ENOENT' })
          expect((await registry.get('acme.demo'))?.versions['2.0.0']).toBeUndefined()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})

function resolvedForSchema(root: string, version: string, stateSchemaVersion: number): ResolvedExtension {
  return {
    id: 'acme.demo',
    version,
    packagePath: root,
    manifest: parseExtensionManifest({
      publisher: 'acme',
      name: 'demo',
      version,
      manifestVersion: 1,
      apiVersion: '1.0.0',
      engines: { kun: '*' },
      main: 'main.mjs',
      activationEvents: ['onStartup'],
      contributes: {},
      permissions: [],
      stateSchemaVersion
    }),
    requestedPermissions: [],
    grantedPermissions: [],
    source: { type: 'development', locator: root },
    development: true,
    generation: 1
  }
}

function installedRecord(
  paths: ExtensionPaths,
  version: string,
  stateSchemaVersion: number
): InstalledExtensionVersion {
  const resolved = resolvedForSchema(paths.packageRoot, version, stateSchemaVersion)
  return {
    version,
    packagePath: paths.packageVersion('acme.demo', version),
    archiveSha256: 'a'.repeat(64),
    integrity: { algorithm: 'sha256', files: {} },
    source: { type: 'local', locator: join(paths.packageRoot, `${version}.kunx`) },
    signatureStatus: 'unsigned',
    requestedPermissions: [],
    grantedPermissions: [],
    installedAt: new Date().toISOString(),
    manifest: resolved.manifest,
    mutable: false
  }
}
