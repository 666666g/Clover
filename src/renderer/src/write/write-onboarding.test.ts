import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  getWriteOnboardingDecision,
  readWriteOnboardingComplete,
  writeWriteOnboardingComplete
} from './write-onboarding'

function memoryStorage(initial: string | null = null): BrowserStorageLike & { value: string | null } {
  return {
    value: initial,
    getItem() {
      return this.value
    },
    setItem(_key, value) {
      this.value = value
    }
  }
}

const root = '/home/user/.kun/write_workspace'
const baseState = {
  persistedComplete: false,
  settingsLoading: false,
  defaultWorkspaceRoot: root,
  workspaceRoots: [root],
  workspaceRoot: root,
  rootDirectory: root,
  entriesByDir: {} as Record<string, WorkspaceEntry[]>,
  loadingDirs: {},
  activeFilePath: null
}

describe('Write onboarding decision', () => {
  it('does not show onboarding before the root directory snapshot loads', () => {
    expect(getWriteOnboardingDecision(baseState)).toBe('pending')
    expect(getWriteOnboardingDecision({
      ...baseState,
      settingsLoading: true,
      entriesByDir: { [root]: [] }
    })).toBe('pending')
    expect(getWriteOnboardingDecision({
      ...baseState,
      loadingDirs: { __root__: true }
    })).toBe('pending')
    expect(getWriteOnboardingDecision({
      ...baseState,
      settingsLoading: true,
      defaultWorkspaceRoot: '',
      workspaceRoots: [root],
      entriesByDir: { [root]: [] }
    })).toBe('pending')
  })

  it('shows onboarding only after a loaded default space is confirmed empty', () => {
    expect(getWriteOnboardingDecision({
      ...baseState,
      entriesByDir: { [root]: [] }
    })).toBe('show')
  })

  it('does not count the managed welcome seed as user-created content', () => {
    expect(getWriteOnboardingDecision({
      ...baseState,
      entriesByDir: {
        [root]: [{
          path: `${root}/welcome.md`,
          name: 'welcome.md',
          type: 'file',
          ext: '.md'
        }]
      }
    })).toBe('show')
  })

  it('completes for existing content, an active file, or a custom writing space', () => {
    expect(getWriteOnboardingDecision({
      ...baseState,
      entriesByDir: {
        [root]: [{ path: `${root}/draft.md`, name: 'draft.md', type: 'file', ext: '.md' }]
      }
    })).toBe('complete')
    expect(getWriteOnboardingDecision({
      ...baseState,
      activeFilePath: `${root}/draft.md`
    })).toBe('complete')
    expect(getWriteOnboardingDecision({
      ...baseState,
      workspaceRoots: [root, '/home/user/Writing'],
      workspaceRoot: '/home/user/Writing'
    })).toBe('complete')
  })
})

describe('Write onboarding persistence', () => {
  it('starts incomplete and persists completion', () => {
    const storage = memoryStorage()

    expect(readWriteOnboardingComplete(storage)).toBe(false)
    writeWriteOnboardingComplete(storage)
    expect(readWriteOnboardingComplete(storage)).toBe(true)
  })

  it('does not treat unknown stored values as complete', () => {
    expect(readWriteOnboardingComplete(memoryStorage('true'))).toBe(false)
  })
})
