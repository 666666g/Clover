import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  documentsIndexPath,
  flushPendingDocumentsIndexes,
  persistDocumentsIndex,
  serializeDocumentsIndex
} from './design-document-persistence'
import { flushDesignPersistenceQueue } from './design-persistence-coordinator'
import type { DesignDocument } from './design-types'

function document(id: string): DesignDocument {
  return {
    id,
    title: id,
    order: 0,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    activeArtifactId: null,
    artifacts: []
  }
}

afterEach(async () => {
  await flushPendingDocumentsIndexes()
  await flushDesignPersistenceQueue()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('design documents index persistence', () => {
  it('retains the latest pending payload per workspace and flushes it before the debounce', async () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      path,
      savedAt: 'now'
    }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    const first = [document('first')]
    const latest = [document('latest')]

    persistDocumentsIndex('/workspace', first, 'first')
    persistDocumentsIndex('/workspace', latest, 'latest')
    await flushPendingDocumentsIndexes('/workspace')

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: documentsIndexPath(),
      workspaceRoot: '/workspace',
      content: serializeDocumentsIndex(latest, 'latest')
    })
  })

  it('keeps pending indexes isolated between workspaces', async () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      path,
      savedAt: 'now'
    }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })

    persistDocumentsIndex('/workspace/a', [document('a')], 'a')
    persistDocumentsIndex('/workspace/b', [document('b')], 'b')
    await flushPendingDocumentsIndexes('/workspace/a')

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(writeWorkspaceFile.mock.calls[0]?.[0]).toMatchObject({ workspaceRoot: '/workspace/a' })
  })
})
