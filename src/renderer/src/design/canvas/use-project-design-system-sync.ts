import { useEffect } from 'react'
import { parseProjectDesignMdWithOfficialLint, projectDesignMdHash } from '../design-md/design-md-adapter'
import { PROJECT_DESIGN_MD_PATH } from '../design-md/design-md-paths'
import { mapProjectDesignMdToNative, removeProjectDesignMdNativeTokens, serializeNativeDesignSystemAsDesignMd } from '../design-md/design-md-native-mapping'
import { useDesignSystemStore } from './design-system-store'
import { useProjectDesignSystemStore } from './project-design-system-store'
import { writeDesignWorkspaceFile } from '../design-persistence-coordinator'

const WATCH_RECOVERY_MS = 1_500
const saveQueues = new Map<string, { key: string; promise: Promise<boolean> }>()

export function projectDesignMdExternalRevisionDecision(
  draft: { dirty: boolean; baseHash: string } | null,
  nextHash: string
): 'apply' | 'ignore-base-replay' | 'conflict' {
  if (!draft?.dirty) return 'apply'
  return draft.baseHash === nextHash ? 'ignore-base-replay' : 'conflict'
}

async function saveProjectDesignMdNow(workspaceRoot: string, content: string, expectedHash: string): Promise<boolean> {
  const api = window.kunGui
  if (!workspaceRoot || !api?.readWorkspaceFile || !api.writeWorkspaceFile) return false
  const current = await api.readWorkspaceFile({ path: PROJECT_DESIGN_MD_PATH, workspaceRoot }).catch(() => null)
  const currentContent = current?.ok ? current.content : ''
  const currentHash = current?.ok ? projectDesignMdHash(currentContent) : ''
  if (useProjectDesignSystemStore.getState().workspaceRoot !== workspaceRoot) return false
  if (currentHash !== expectedHash) {
    useProjectDesignSystemStore.getState().setConflict({ baseHash: expectedHash, currentHash, draftContent: content, currentContent })
    return false
  }
  const parsed = await parseProjectDesignMdWithOfficialLint(content)
  if (!parsed.ok || !parsed.document) {
    useProjectDesignSystemStore.getState().setInvalid(parsed.diagnostics)
    return false
  }
  useProjectDesignSystemStore.getState().setSaving()
  const written = await writeDesignWorkspaceFile(
    { path: PROJECT_DESIGN_MD_PATH, workspaceRoot, content },
    api
  )
  if (useProjectDesignSystemStore.getState().workspaceRoot !== workspaceRoot) return false
  if (!written.ok) {
    useProjectDesignSystemStore.getState().setDraft(content)
    return false
  }
  useProjectDesignSystemStore.getState().setReady(parsed.document)
  const native = useDesignSystemStore.getState()
  native.loadSystem(mapProjectDesignMdToNative(parsed.document, native.system))
  return true
}

export function saveProjectDesignMd(workspaceRoot: string, content: string, expectedHash: string): Promise<boolean> {
  const key = `${expectedHash}:${projectDesignMdHash(content)}`
  const active = saveQueues.get(workspaceRoot)
  if (active?.key === key) return active.promise
  const previous = active?.promise ?? Promise.resolve(true)
  const queued = previous.catch(() => false).then(() => saveProjectDesignMdNow(workspaceRoot, content, expectedHash))
  saveQueues.set(workspaceRoot, { key, promise: queued })
  void queued.finally(() => {
    if (saveQueues.get(workspaceRoot)?.promise === queued) saveQueues.delete(workspaceRoot)
  })
  return queued
}

/** Persist only after an explicit design_system operation; ordinary document-sidecar loads must never create DESIGN.md. */
export async function persistNativeDesignSystemToProjectDesignMd(workspaceRoot: string): Promise<boolean> {
  const project = useProjectDesignSystemStore.getState()
  const content = serializeNativeDesignSystemAsDesignMd(
    useDesignSystemStore.getState().system,
    project.document
  )
  project.setDraft(content)
  return saveProjectDesignMd(workspaceRoot, content, project.document?.sourceHash ?? '')
}

export function useProjectDesignSystemSync(workspaceRoot: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !workspaceRoot) return
    const api = window.kunGui
    if (!api?.readWorkspaceFile) return
    let cancelled = false
    let applyingExternal = false
    let generation = 0
    let applyGeneration = 0
    let watchId: string | null = null
    let offChanged: (() => void) | null = null
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null

    const clearWatch = (): void => {
      offChanged?.()
      offChanged = null
      if (watchId && api.unwatchWorkspaceFile) void api.unwatchWorkspaceFile(watchId).catch(() => undefined)
      watchId = null
    }
    useProjectDesignSystemStore.getState().activateWorkspace(workspaceRoot)
    const apply = async (content: string, truncated = false): Promise<void> => {
      const requestGeneration = ++applyGeneration
      const state = useProjectDesignSystemStore.getState()
      const nextHash = projectDesignMdHash(content)
      const decision = projectDesignMdExternalRevisionDecision(state.draft, nextHash)
      if (decision !== 'apply') {
        if (decision === 'conflict' && state.draft) {
          state.setConflict({ baseHash: state.draft.baseHash, currentHash: nextHash, draftContent: state.draft.content, currentContent: content })
        }
        // A watcher/poll replay of the unchanged base revision must not erase
        // an unsaved inspector draft.
        return
      }
      const parsed = await parseProjectDesignMdWithOfficialLint(content, { truncated })
      if (cancelled || requestGeneration !== applyGeneration) return
      const latest = useProjectDesignSystemStore.getState()
      const latestDecision = projectDesignMdExternalRevisionDecision(latest.draft, nextHash)
      if (latestDecision !== 'apply') {
        if (latestDecision === 'conflict' && latest.draft) {
          latest.setConflict({ baseHash: latest.draft.baseHash, currentHash: nextHash, draftContent: latest.draft.content, currentContent: content })
        }
        return
      }
      if (!parsed.ok || !parsed.document) latest.setInvalid(parsed.diagnostics)
      else {
        latest.setReady(parsed.document)
        const native = useDesignSystemStore.getState()
        applyingExternal = true
        native.loadSystem(mapProjectDesignMdToNative(parsed.document, native.system))
        applyingExternal = false
      }
    }
    const scheduleRecovery = (load: () => Promise<void>): void => {
      if (cancelled || recoveryTimer) return
      recoveryTimer = setTimeout(() => { recoveryTimer = null; void load() }, WATCH_RECOVERY_MS)
    }
    const load = async (): Promise<void> => {
      const requestGeneration = ++generation
      const result = await api.readWorkspaceFile({ path: PROJECT_DESIGN_MD_PATH, workspaceRoot }).catch(() => null)
      if (cancelled || requestGeneration !== generation) return
      if (!result?.ok) {
        clearWatch()
        useProjectDesignSystemStore.getState().setMissing()
        const native = useDesignSystemStore.getState()
        applyingExternal = true
        native.loadSystem(removeProjectDesignMdNativeTokens(native.system))
        applyingExternal = false
        scheduleRecovery(load)
        return
      }
      await apply(result.content, result.truncated)
      if (!watchId && api.watchWorkspaceFile && api.onWorkspaceFileChanged) {
        offChanged = api.onWorkspaceFileChanged((payload) => {
          if (cancelled || payload.watchId !== watchId) return
          if (!payload.ok) {
            clearWatch()
            void load()
          } else void apply(payload.content, payload.truncated)
        })
        const watch = await api.watchWorkspaceFile({ path: PROJECT_DESIGN_MD_PATH, workspaceRoot }).catch(() => null)
        if (cancelled) {
          if (watch?.ok && api.unwatchWorkspaceFile) void api.unwatchWorkspaceFile(watch.watchId).catch(() => undefined)
          return
        }
        if (watch?.ok) { watchId = watch.watchId; await apply(watch.content, watch.truncated) }
        else { offChanged?.(); offChanged = null }
      }
      // Atomic rename saves can detach fs.watch. A bounded recovery read repairs it.
      scheduleRecovery(load)
    }

    useProjectDesignSystemStore.getState().setLoading()
    void load()
    return () => {
      cancelled = true
      generation += 1
      applyGeneration += 1
      if (recoveryTimer) clearTimeout(recoveryTimer)
      clearWatch()
    }
  }, [enabled, workspaceRoot])
}
