import type { WorkspaceEntry } from '@shared/workspace-file'
import { DEFAULT_WRITE_WELCOME_FILE_NAME } from '@shared/app-settings'
import { browserStorage, type BrowserStorageLike } from '../lib/browser-storage'

const WRITE_ONBOARDING_STORAGE_KEY = 'kun.write.onboarding.v1'

export type WriteOnboardingDecision = 'pending' | 'show' | 'complete'

type WriteOnboardingState = {
  persistedComplete: boolean
  settingsLoading: boolean
  defaultWorkspaceRoot: string
  workspaceRoots: string[]
  workspaceRoot: string
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  loadingDirs: Record<string, boolean>
  activeFilePath: string | null
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function directorySnapshot(
  entriesByDir: Record<string, WorkspaceEntry[]>,
  candidates: string[]
): WorkspaceEntry[] | undefined {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(entriesByDir, candidate)) {
      return entriesByDir[candidate]
    }
  }
  const normalizedCandidates = new Set(candidates.map(normalizePath).filter(Boolean))
  const matched = Object.keys(entriesByDir).find((path) =>
    normalizedCandidates.has(normalizePath(path))
  )
  return matched ? entriesByDir[matched] : undefined
}

function isManagedDefaultWelcomeEntry(
  entry: WorkspaceEntry,
  root: string,
  defaultRoot: string
): boolean {
  if (!defaultRoot || root !== defaultRoot || entry.type !== 'file') return false
  return normalizePath(entry.path) === `${defaultRoot}/${DEFAULT_WRITE_WELCOME_FILE_NAME}`
}

export function getWriteOnboardingDecision(
  state: WriteOnboardingState
): WriteOnboardingDecision {
  if (state.persistedComplete || state.activeFilePath) return 'complete'
  // Workspace roots are populated as part of the same settings load. Do not
  // classify a partially loaded default root as a custom space and persist a
  // false completion before initialization has finished.
  if (state.settingsLoading) return 'pending'

  const defaultRoot = normalizePath(state.defaultWorkspaceRoot)
  const hasConfiguredCustomWorkspace = state.workspaceRoots.some((root) => {
    const normalized = normalizePath(root)
    return Boolean(normalized && normalized !== defaultRoot)
  })
  if (hasConfiguredCustomWorkspace) return 'complete'

  const workspaceRoot = normalizePath(state.workspaceRoot)
  if (!workspaceRoot) return 'pending'
  const rootDirectory = normalizePath(state.rootDirectory)
  const root = rootDirectory || workspaceRoot
  const rootLoading = Boolean(
    state.loadingDirs.__root__ ||
    state.loadingDirs[state.rootDirectory] ||
    state.loadingDirs[state.workspaceRoot] ||
    state.loadingDirs[root]
  )
  if (rootLoading) return 'pending'

  const entries = directorySnapshot(state.entriesByDir, [
    state.rootDirectory,
    state.workspaceRoot,
    root
  ].filter(Boolean))
  if (!entries) return 'pending'
  const userEntries = entries.filter((entry) =>
    !isManagedDefaultWelcomeEntry(entry, root, defaultRoot)
  )
  return userEntries.length > 0 ? 'complete' : 'show'
}

export function readWriteOnboardingComplete(
  storage: BrowserStorageLike | null = browserStorage()
): boolean {
  try {
    return storage?.getItem(WRITE_ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeWriteOnboardingComplete(
  storage: BrowserStorageLike | null = browserStorage()
): void {
  try {
    storage?.setItem(WRITE_ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Onboarding persistence is optional; Write must remain usable without it.
  }
}
