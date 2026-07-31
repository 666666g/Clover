import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDesignWorkspaceStore } from './design-workspace-store'

const createdAt = '2026-06-20T00:00:00.000Z'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

afterEach(() => vi.unstubAllGlobals())

describe('design workspace isolation', () => {
  it('rejects a late hydration result after the workspace changes', async () => {
    const indexRead = deferred<{ ok: true; content: string }>()
    const readWorkspaceFile = vi.fn((request: { path: string }) => {
      if (request.path === '.kun-design/documents.json') return indexRead.promise
      return Promise.resolve({ ok: false as const, message: 'missing' })
    })
    const listWorkspaceDirectory = vi.fn(async () => ({
      ok: true as const,
      entries: [] as Array<{ name: string; type: 'file' | 'directory' }>
    }))
    const writeWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      path,
      savedAt: createdAt
    }))
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, readWorkspaceFile, listWorkspaceDirectory }
    })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace/a',
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null
    })

    const hydration = useDesignWorkspaceStore.getState().rehydrateArtifacts()
    await Promise.resolve()
    useDesignWorkspaceStore.getState().setWorkspaceRoot('/workspace/b')
    indexRead.resolve({
      ok: true,
      content: JSON.stringify({
        version: 1,
        activeDocumentId: 'stale-doc',
        documents: [{
          id: 'stale-doc',
          title: 'Stale',
          order: 0,
          createdAt,
          updatedAt: createdAt,
          activeArtifactId: null
        }]
      })
    })
    await hydration

    expect(useDesignWorkspaceStore.getState()).toMatchObject({
      workspaceRoot: '/workspace/b',
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null
    })
    expect(listWorkspaceDirectory).not.toHaveBeenCalled()
  })
})
