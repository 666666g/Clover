import type {
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult
} from '@shared/workspace-file'

export type DesignPersistenceFailure = {
  operation: 'write' | 'delete'
  workspaceRoot: string
  path: string
  message: string
}

export type DesignPersistenceApi = {
  writeWorkspaceFile?: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  deleteWorkspaceEntry?: (payload: WorkspaceEntryDeletePayload) => Promise<WorkspaceEntryDeleteResult>
}

type DesignPersistenceFailureHandler = (failure: DesignPersistenceFailure) => void

const operationQueues = new Map<string, Promise<unknown>>()
let failureHandler: DesignPersistenceFailureHandler | null = null

export function normalizeDesignPersistenceWorkspaceRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function operationKey(workspaceRoot: string, path: string): string {
  return `${normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)}\0${normalizePath(path)}`
}

function defaultApi(): DesignPersistenceApi | undefined {
  return typeof window === 'undefined' ? undefined : window.kunGui
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publishFailure(failure: DesignPersistenceFailure): void {
  failureHandler?.(failure)
}

function enqueueDesignPersistenceOperation<T>(
  workspaceRoot: string,
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = operationKey(workspaceRoot, path)
  const previous = operationQueues.get(key)
  const task = previous
    ? previous.catch(() => undefined).then(operation)
    : operation()
  operationQueues.set(key, task)
  void task.finally(() => {
    if (operationQueues.get(key) === task) operationQueues.delete(key)
  }).catch(() => undefined)
  return task
}

export function setDesignPersistenceFailureHandler(
  handler: DesignPersistenceFailureHandler | null
): void {
  failureHandler = handler
}

export function writeDesignWorkspaceFile(
  payload: WorkspaceFileWritePayload,
  api: DesignPersistenceApi | undefined = defaultApi()
): Promise<WorkspaceFileWriteResult> {
  const workspaceRoot = payload.workspaceRoot ?? ''
  return enqueueDesignPersistenceOperation(workspaceRoot, payload.path, async () => {
    if (typeof api?.writeWorkspaceFile !== 'function') {
      const result = { ok: false as const, message: 'Workspace file writing is unavailable.' }
      publishFailure({ operation: 'write', workspaceRoot, path: payload.path, message: result.message })
      return result
    }
    try {
      const result = await api.writeWorkspaceFile(payload)
      if (!result.ok) {
        publishFailure({ operation: 'write', workspaceRoot, path: payload.path, message: result.message })
      }
      return result
    } catch (error) {
      const result = { ok: false as const, message: errorMessage(error) }
      publishFailure({ operation: 'write', workspaceRoot, path: payload.path, message: result.message })
      return result
    }
  })
}

export function deleteDesignWorkspaceEntry(
  payload: WorkspaceEntryDeletePayload,
  api: DesignPersistenceApi | undefined = defaultApi()
): Promise<WorkspaceEntryDeleteResult> {
  return enqueueDesignPersistenceOperation(payload.workspaceRoot, payload.path, async () => {
    if (typeof api?.deleteWorkspaceEntry !== 'function') {
      const result = { ok: false as const, message: 'Workspace entry deletion is unavailable.' }
      publishFailure({
        operation: 'delete',
        workspaceRoot: payload.workspaceRoot,
        path: payload.path,
        message: result.message
      })
      return result
    }
    try {
      const result = await api.deleteWorkspaceEntry(payload)
      if (!result.ok) {
        publishFailure({
          operation: 'delete',
          workspaceRoot: payload.workspaceRoot,
          path: payload.path,
          message: result.message
        })
      }
      return result
    } catch (error) {
      const result = { ok: false as const, message: errorMessage(error) }
      publishFailure({
        operation: 'delete',
        workspaceRoot: payload.workspaceRoot,
        path: payload.path,
        message: result.message
      })
      return result
    }
  })
}

export async function flushDesignPersistenceQueue(workspaceRoot?: string): Promise<void> {
  const normalizedRoot = workspaceRoot === undefined
    ? null
    : normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  for (;;) {
    const tasks = [...operationQueues.entries()]
      .filter(([key]) => normalizedRoot === null || key.startsWith(`${normalizedRoot}\0`))
      .map(([, task]) => task)
    if (tasks.length === 0) return
    await Promise.all(tasks.map((task) => task.catch(() => undefined)))
    await Promise.resolve()
  }
}

export function clearDesignPersistenceCoordinatorForTests(): void {
  operationQueues.clear()
  failureHandler = null
}
