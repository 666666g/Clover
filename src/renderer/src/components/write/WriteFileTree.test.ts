import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { WriteFileTree } from './WriteFileTree'

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    fileTreeRevealInFinder: 'Reveal in Finder',
    fileTreeRevealInFileManager: 'Reveal in file manager',
    writeRenameEntry: 'Rename',
    writeDeleteFile: 'Delete file'
  }
  const t = (key: string) => labels[key] ?? key
  return { useTranslation: () => ({ t }) }
})

const entry: WorkspaceEntry = {
  name: 'draft.md',
  path: '/repo/draft.md',
  type: 'file',
  ext: '.md'
}

describe('WriteFileTree reveal action', () => {
  let renderer: ReactTestRenderer
  const onRevealEntry = vi.fn()

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', { kunGui: { platform: 'linux' } })
    onRevealEntry.mockClear()
    await act(async () => {
      renderer = create(createElement(WriteFileTree, {
        rootDirectory: '/repo',
        entriesByDir: { '/repo': [entry] },
        expandedDirs: new Set<string>(),
        loadingDirs: {},
        selectedFilePath: null,
        error: null,
        onToggleDir: () => undefined,
        onSelectFile: () => undefined,
        onCreateFile: () => undefined,
        onCreateDirectory: () => undefined,
        onRenameEntry: () => undefined,
        onDeleteEntry: () => undefined,
        onRevealEntry,
        onRefresh: () => undefined,
        showHeader: false,
        showRootLabel: false
      }))
    })
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
    vi.unstubAllGlobals()
  })

  it('exposes an accessible action and reveals the selected entry', async () => {
    const revealButton = renderer.root.findByProps({ 'aria-label': 'Reveal in file manager' })
    const stopPropagation = vi.fn()

    await act(async () => revealButton.props.onClick({ stopPropagation }))

    expect(stopPropagation).toHaveBeenCalled()
    expect(onRevealEntry).toHaveBeenCalledWith(entry)
  })
})
