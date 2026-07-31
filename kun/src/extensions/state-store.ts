import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AtomicJsonFile } from './atomic-json.js'
import { extensionError } from './errors.js'
import { ExtensionPaths, assertExtensionId } from './paths.js'
import type { JsonValue } from './types.js'

export const DEFAULT_EXTENSION_STATE_BYTES = 10 * 1024 * 1024
export const DEFAULT_EXTENSION_STATE_MIGRATION_TIMEOUT_MS = 30_000

export type ExtensionStateData = {
  global: Record<string, JsonValue>
  workspaces: Record<string, Record<string, JsonValue>>
}

export type ExtensionStateDocument = ExtensionStateData & {
  schemaVersion: number
  revision: number
  committedAt: string
}

type MigrationMarker = {
  transactionId: string
  extensionId: string
  from: number
  to: number
  phase: 'started' | 'prepared' | 'committed'
  backupPath: string
  stagedPath: string
  stagedDigest?: string
  startedAt: string
}

export type StateMigration = (
  from: number,
  to: number,
  state: ExtensionStateData,
  signal: AbortSignal
) => Promise<ExtensionStateData>

export type ExtensionStateVersionSwitchTransaction = {
  exists(): Promise<boolean>
  read(initialSchemaVersion?: number): Promise<ExtensionStateDocument>
  migrate(targetSchemaVersion: number, migrate: StateMigration): Promise<ExtensionStateDocument>
  restoreCompatibleSnapshot(targetSchemaVersion: number): Promise<ExtensionStateDocument>
  createRecoverySnapshot(
    transactionId: string,
    state: ExtensionStateDocument
  ): Promise<{ backupName: string; digest: string }>
  restoreRecoverySnapshot(
    backupName: string,
    expectedDigest: string
  ): Promise<ExtensionStateDocument>
  replace(state: ExtensionStateDocument): Promise<void>
  remove(): Promise<void>
  digest(state: ExtensionStateDocument): string
}

export type ExtensionStateDiagnostic = {
  available: boolean
  code?: string
  message?: string
  selectedVersion?: string
  stateSchemaVersion: number
  availableVersions: { version: string; stateSchemaVersion: number }[]
}

export class ExtensionStateStore {
  private readonly files = new Map<string, AtomicJsonFile<ExtensionStateDocument>>()
  private readonly operations = new Map<string, Promise<unknown>>()

  constructor(
    readonly paths: ExtensionPaths,
    private readonly options: {
      maxBytes?: number
      migrationTimeoutMs?: number
      now?: () => Date
    } = {}
  ) {}

  async read(extensionId: string, initialSchemaVersion = 0): Promise<ExtensionStateDocument> {
    assertExtensionId(extensionId)
    return this.serialize(extensionId, async () => {
      await this.recoverIncompleteMigration(extensionId)
      return structuredClone(
        await this.file(extensionId).read(() => emptyState(initialSchemaVersion, this.now()))
      )
    })
  }

  async getGlobal(extensionId: string, key: string): Promise<JsonValue | undefined> {
    return (await this.read(extensionId)).global[key]
  }

  async setGlobal(extensionId: string, key: string, value: JsonValue | undefined): Promise<void> {
    validateStateKey(key)
    await this.update(extensionId, (state) => {
      if (value === undefined) delete state.global[key]
      else state.global[key] = structuredClone(value)
    })
  }

  async getWorkspace(
    extensionId: string,
    workspaceKey: string,
    key: string
  ): Promise<JsonValue | undefined> {
    validateWorkspaceKey(workspaceKey)
    validateStateKey(key)
    return (await this.read(extensionId)).workspaces[workspaceKey]?.[key]
  }

  async setWorkspace(
    extensionId: string,
    workspaceKey: string,
    key: string,
    value: JsonValue | undefined
  ): Promise<void> {
    validateWorkspaceKey(workspaceKey)
    validateStateKey(key)
    await this.update(extensionId, (state) => {
      const workspace = state.workspaces[workspaceKey] ?? {}
      if (value === undefined) delete workspace[key]
      else workspace[key] = structuredClone(value)
      if (Object.keys(workspace).length === 0) delete state.workspaces[workspaceKey]
      else state.workspaces[workspaceKey] = workspace
    })
  }

  /**
   * Holds the same per-extension serialization fence used by ordinary state
   * reads and writes for the complete package-selection transaction. This
   * prevents a broker state write from landing between migration commit and
   * the selected-version registry commit.
   */
  async runVersionSwitchTransaction<T>(
    extensionId: string,
    operation: (transaction: ExtensionStateVersionSwitchTransaction) => Promise<T>
  ): Promise<T> {
    assertExtensionId(extensionId)
    return this.serialize(extensionId, async () => {
      await this.recoverIncompleteMigration(extensionId)
      const file = this.file(extensionId)
      const transaction: ExtensionStateVersionSwitchTransaction = {
        exists: () => fileExists(file.path),
        read: async (initialSchemaVersion = 0) => structuredClone(
          await file.read(() => emptyState(initialSchemaVersion, this.now()))
        ),
        migrate: (targetSchemaVersion, migrate) =>
          this.migrateUnlocked(extensionId, targetSchemaVersion, migrate),
        restoreCompatibleSnapshot: (targetSchemaVersion) =>
          this.restoreCompatibleSnapshotUnlocked(extensionId, targetSchemaVersion),
        createRecoverySnapshot: (transactionId, state) =>
          this.createRecoverySnapshot(extensionId, transactionId, state),
        restoreRecoverySnapshot: (backupName, expectedDigest) =>
          this.restoreRecoverySnapshot(extensionId, backupName, expectedDigest),
        replace: async (state) => {
          const validated = validateStateDocument(structuredClone(state))
          this.enforceQuota(validated)
          await file.write(validated)
        },
        remove: () => rm(file.path, { force: true }),
        digest: (state) => digestState(validateStateDocument(structuredClone(state)))
      }
      return operation(transaction)
    })
  }

  async migrate(
    extensionId: string,
    targetSchemaVersion: number,
    migrate: StateMigration
  ): Promise<ExtensionStateDocument> {
    return this.runVersionSwitchTransaction(
      extensionId,
      (transaction) => transaction.migrate(targetSchemaVersion, migrate)
    )
  }

  async restoreCompatibleSnapshot(
    extensionId: string,
    targetSchemaVersion: number
  ): Promise<ExtensionStateDocument> {
    return this.runVersionSwitchTransaction(
      extensionId,
      (transaction) => transaction.restoreCompatibleSnapshot(targetSchemaVersion)
    )
  }

  private async migrateUnlocked(
    extensionId: string,
    targetSchemaVersion: number,
    migrate: StateMigration
  ): Promise<ExtensionStateDocument> {
    if (!Number.isSafeInteger(targetSchemaVersion) || targetSchemaVersion < 0) {
      throw extensionError('EXTENSION_STATE_SCHEMA_INVALID', 'Target state schema is invalid', {
        targetSchemaVersion
      })
    }
    const file = this.file(extensionId)
    const current = await file.read(() => emptyState(0, this.now()))
    if (targetSchemaVersion === current.schemaVersion) return structuredClone(current)
    if (targetSchemaVersion < current.schemaVersion) {
      throw extensionError(
        'EXTENSION_STATE_DOWNGRADE_FORBIDDEN',
        'State schema downgrades require a compatible retained snapshot',
        { current: current.schemaVersion, target: targetSchemaVersion }
      )
    }

    const transactionId = randomUUID()
    const stateDirectory = this.paths.stateDirectory(extensionId)
    const stagingDirectory = join(stateDirectory, 'migrations')
    const backupDirectory = this.paths.backupsDirectory(extensionId)
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 })
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
    const backupPath = join(
      backupDirectory,
      `${this.now().toISOString().replaceAll(':', '-')}-schema-${current.schemaVersion}-${transactionId}.json`
    )
    const stagedPath = join(stagingDirectory, `${transactionId}.json`)
    const markerFile = this.markerFile(extensionId)
    const marker: MigrationMarker = {
      transactionId,
      extensionId,
      from: current.schemaVersion,
      to: targetSchemaVersion,
      phase: 'started',
      backupPath,
      stagedPath,
      startedAt: this.now().toISOString()
    }
    await new AtomicJsonFile(backupPath, validateStateDocument).write(current)
    await markerFile.write(marker)

    const controller = new AbortController()
    const timeoutMs = this.options.migrationTimeoutMs ?? DEFAULT_EXTENSION_STATE_MIGRATION_TIMEOUT_MS
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const migrated = await Promise.race([
        migrate(
          current.schemaVersion,
          targetSchemaVersion,
          { global: structuredClone(current.global), workspaces: structuredClone(current.workspaces) },
          controller.signal
        ),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(extensionError(
            'EXTENSION_STATE_MIGRATION_TIMEOUT',
            'Extension state migration timed out',
            { from: current.schemaVersion, to: targetSchemaVersion, timeoutMs }
          )), { once: true })
        })
      ])
      const next: ExtensionStateDocument = validateStateDocument({
        schemaVersion: targetSchemaVersion,
        revision: current.revision + 1,
        committedAt: this.now().toISOString(),
        global: migrated.global,
        workspaces: migrated.workspaces
      })
      this.enforceQuota(next)
      await new AtomicJsonFile(stagedPath, validateStateDocument).write(next)
      marker.phase = 'prepared'
      marker.stagedDigest = digestState(next)
      await markerFile.write(marker)
      await file.write(next)
      marker.phase = 'committed'
      await markerFile.write(marker)
      await rm(stagedPath, { force: true })
      await rm(markerFile.path, { force: true })
      return structuredClone(next)
    } catch (error) {
      controller.abort()
      await file.write(current).catch(() => undefined)
      await rm(stagedPath, { force: true }).catch(() => undefined)
      await rm(markerFile.path, { force: true }).catch(() => undefined)
      throw extensionError(
        'EXTENSION_STATE_MIGRATION_FAILED',
        'Extension state migration failed and prior state was retained',
        { extensionId, from: current.schemaVersion, to: targetSchemaVersion, backupPath },
        error
      )
    } finally {
      clearTimeout(timer)
    }
  }

  private async restoreCompatibleSnapshotUnlocked(
    extensionId: string,
    targetSchemaVersion: number
  ): Promise<ExtensionStateDocument> {
    const backupDirectory = this.paths.backupsDirectory(extensionId)
    const candidates = await readdir(backupDirectory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    })
    candidates.sort().reverse()
    for (const name of candidates) {
      if (!name.includes(`-schema-${targetSchemaVersion}-`) || !name.endsWith('.json')) continue
      const snapshot = await new AtomicJsonFile(
        join(backupDirectory, name),
        validateStateDocument
      ).read(() => {
        throw extensionError('EXTENSION_STATE_SNAPSHOT_INVALID', 'State snapshot disappeared')
      })
      if (snapshot.schemaVersion !== targetSchemaVersion) continue
      const current = await this.file(extensionId).read(() => emptyState(0, this.now()))
      const safetyBackup = join(
        backupDirectory,
        `${this.now().toISOString().replaceAll(':', '-')}-schema-${current.schemaVersion}-${randomUUID()}.json`
      )
      await new AtomicJsonFile(safetyBackup, validateStateDocument).write(current)
      await this.file(extensionId).write(snapshot)
      return structuredClone(snapshot)
    }
    throw extensionError(
      'EXTENSION_STATE_ROLLBACK_UNAVAILABLE',
      'No compatible state snapshot is available for rollback',
      { extensionId, targetSchemaVersion }
    )
  }

  private async createRecoverySnapshot(
    extensionId: string,
    transactionId: string,
    state: ExtensionStateDocument
  ): Promise<{ backupName: string; digest: string }> {
    validateTransactionId(transactionId)
    const validated = validateStateDocument(structuredClone(state))
    this.enforceQuota(validated)
    const backupDirectory = this.paths.backupsDirectory(extensionId)
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
    const backupName = `${this.now().toISOString().replaceAll(':', '-')}-schema-${validated.schemaVersion}-switch-${transactionId}.json`
    await new AtomicJsonFile(join(backupDirectory, backupName), validateStateDocument).write(validated)
    return { backupName, digest: digestState(validated) }
  }

  private async restoreRecoverySnapshot(
    extensionId: string,
    backupName: string,
    expectedDigest: string
  ): Promise<ExtensionStateDocument> {
    validateRecoveryBackupName(backupName)
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
        'Version switch backup digest is invalid',
        { extensionId }
      )
    }
    const snapshot = await new AtomicJsonFile(
      join(this.paths.backupsDirectory(extensionId), backupName),
      validateStateDocument
    ).read(() => {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_RECOVERY_FAILED',
        'Version switch recovery snapshot is missing',
        { extensionId, backupName }
      )
    })
    if (digestState(snapshot) !== expectedDigest) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_RECOVERY_FAILED',
        'Version switch recovery snapshot digest does not match',
        { extensionId, backupName }
      )
    }
    await this.file(extensionId).write(snapshot)
    return structuredClone(snapshot)
  }

  async diagnoseVersion(
    extensionId: string,
    selectedVersion: string | undefined,
    availableVersions: { version: string; stateSchemaVersion: number }[]
  ): Promise<ExtensionStateDiagnostic> {
    const state = await this.read(extensionId)
    const selected = availableVersions.find((version) => version.version === selectedVersion)
    if (selectedVersion === undefined || selected === undefined) {
      return {
        available: false,
        code: 'EXTENSION_VERSION_UNAVAILABLE',
        message: 'Selected extension version is not installed',
        selectedVersion,
        stateSchemaVersion: state.schemaVersion,
        availableVersions: structuredClone(availableVersions)
      }
    }
    if (selected.stateSchemaVersion !== state.schemaVersion) {
      return {
        available: false,
        code: selected.stateSchemaVersion < state.schemaVersion
          ? 'EXTENSION_STATE_DOWNGRADE_FORBIDDEN'
          : 'EXTENSION_STATE_MIGRATION_REQUIRED',
        message: 'Selected extension version is incompatible with committed state schema',
        selectedVersion,
        stateSchemaVersion: state.schemaVersion,
        availableVersions: structuredClone(availableVersions)
      }
    }
    return {
      available: true,
      selectedVersion,
      stateSchemaVersion: state.schemaVersion,
      availableVersions: structuredClone(availableVersions)
    }
  }

  private async update(
    extensionId: string,
    mutate: (state: ExtensionStateDocument) => void
  ): Promise<void> {
    assertExtensionId(extensionId)
    await this.serialize(extensionId, async () => {
      await this.recoverIncompleteMigration(extensionId)
      const file = this.file(extensionId)
      const current = await file.read(() => emptyState(0, this.now()))
      const next = structuredClone(current)
      mutate(next)
      next.revision += 1
      next.committedAt = this.now().toISOString()
      validateStateDocument(next)
      this.enforceQuota(next)
      await file.write(next)
    })
  }

  private async recoverIncompleteMigration(extensionId: string): Promise<void> {
    const markerFile = this.markerFile(extensionId)
    let marker: MigrationMarker
    try {
      marker = await markerFile.read(() => {
        throw extensionError('EXTENSION_STATE_MIGRATION_MARKER_MISSING', 'Migration marker is missing')
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
      if ((error as { code?: string })?.code === 'EXTENSION_STATE_MIGRATION_MARKER_MISSING') return
      throw error
    }
    if (marker.extensionId !== extensionId) {
      throw extensionError('EXTENSION_STATE_MIGRATION_MARKER_INVALID', 'Migration marker identity is invalid')
    }
    if (marker.phase === 'committed') {
      const current = await this.file(extensionId).read(() => emptyState(0, this.now()))
      if (current.schemaVersion === marker.to && digestState(current) === marker.stagedDigest) {
        await rm(marker.stagedPath, { force: true }).catch(() => undefined)
        await rm(markerFile.path, { force: true })
        return
      }
    }
    const backup = await new AtomicJsonFile(marker.backupPath, validateStateDocument).read(() => {
      throw extensionError(
        'EXTENSION_STATE_RECOVERY_FAILED',
        'Incomplete migration has no recoverable backup',
        { extensionId, transactionId: marker.transactionId }
      )
    })
    await this.file(extensionId).write(backup)
    await rm(marker.stagedPath, { force: true }).catch(() => undefined)
    await rm(markerFile.path, { force: true })
  }

  private file(extensionId: string): AtomicJsonFile<ExtensionStateDocument> {
    let file = this.files.get(extensionId)
    if (file === undefined) {
      file = new AtomicJsonFile(
        join(this.paths.stateDirectory(extensionId), 'current.json'),
        validateStateDocument
      )
      this.files.set(extensionId, file)
    }
    return file
  }

  private markerFile(extensionId: string): AtomicJsonFile<MigrationMarker> {
    return new AtomicJsonFile(
      join(this.paths.stateDirectory(extensionId), 'migration.json'),
      validateMigrationMarker
    )
  }

  private enforceQuota(state: ExtensionStateDocument): void {
    const maximum = this.options.maxBytes ?? DEFAULT_EXTENSION_STATE_BYTES
    const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
    if (bytes > maximum) {
      throw extensionError('EXTENSION_STATE_QUOTA_EXCEEDED', 'Extension state exceeds quota', {
        bytes,
        maximum
      })
    }
  }

  private serialize<T>(extensionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.operations.get(extensionId) ?? Promise.resolve()
    const result = prior.then(operation, operation)
    this.operations.set(extensionId, result.then(
      () => undefined,
      () => undefined
    ))
    return result
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

function emptyState(schemaVersion: number, now: Date): ExtensionStateDocument {
  return {
    schemaVersion,
    revision: 0,
    committedAt: now.toISOString(),
    global: {},
    workspaces: {}
  }
}

function validateStateDocument(value: unknown): ExtensionStateDocument {
  if (!isRecord(value)) throw extensionError('EXTENSION_STATE_INVALID', 'State must be an object')
  if (
    !Number.isSafeInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 0 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.committedAt !== 'string' ||
    !isRecord(value.global) ||
    !isRecord(value.workspaces)
  ) {
    throw extensionError('EXTENSION_STATE_INVALID', 'State document metadata is invalid')
  }
  assertJson(value.global)
  for (const [workspaceKey, workspace] of Object.entries(value.workspaces)) {
    validateWorkspaceKey(workspaceKey)
    if (!isRecord(workspace)) {
      throw extensionError('EXTENSION_STATE_INVALID', 'Workspace state must be an object', {
        workspaceKey
      })
    }
    assertJson(workspace)
  }
  return value as unknown as ExtensionStateDocument
}

function validateMigrationMarker(value: unknown): MigrationMarker {
  if (
    !isRecord(value) ||
    typeof value.transactionId !== 'string' ||
    typeof value.extensionId !== 'string' ||
    !Number.isSafeInteger(value.from) ||
    !Number.isSafeInteger(value.to) ||
    !['started', 'prepared', 'committed'].includes(String(value.phase)) ||
    typeof value.backupPath !== 'string' ||
    typeof value.stagedPath !== 'string' ||
    typeof value.startedAt !== 'string'
  ) {
    throw extensionError('EXTENSION_STATE_MIGRATION_MARKER_INVALID', 'Migration marker is invalid')
  }
  return value as unknown as MigrationMarker
}

function validateStateKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 500 ||
    key.includes('\0') ||
    key === '__proto__' ||
    key === 'prototype' ||
    key === 'constructor'
  ) {
    throw extensionError('EXTENSION_STATE_KEY_INVALID', 'Extension state key is invalid')
  }
}

function validateWorkspaceKey(workspaceKey: string): void {
  if (!/^[a-f0-9]{64}$/.test(workspaceKey)) {
    throw extensionError('EXTENSION_WORKSPACE_KEY_INVALID', 'Workspace key is invalid', { workspaceKey })
  }
}

function validateTransactionId(transactionId: string): void {
  if (!/^[a-f0-9-]{16,64}$/i.test(transactionId)) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
      'Version switch transaction ID is invalid'
    )
  }
}

function validateRecoveryBackupName(backupName: string): void {
  if (
    backupName.length === 0 ||
    backupName.length > 255 ||
    backupName === '.' ||
    backupName === '..' ||
    backupName.includes('/') ||
    backupName.includes('\\') ||
    backupName.includes('\0') ||
    !backupName.endsWith('.json')
  ) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
      'Version switch recovery snapshot name is invalid'
    )
  }
}

function assertJson(value: unknown): asserts value is JsonValue {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('not serializable')
    JSON.parse(serialized)
  } catch (error) {
    throw extensionError('EXTENSION_STATE_INVALID', 'Extension state must be JSON serializable', {}, error)
  }
}

function digestState(state: ExtensionStateDocument): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
