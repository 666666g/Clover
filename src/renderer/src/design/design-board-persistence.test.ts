import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureDesignBoardArtifact } from './design-board'
import { installDesignDocument } from './design-board.test-helpers'
import { useDesignWorkspaceStore } from './design-workspace-store'

afterEach(() => vi.unstubAllGlobals())

describe('design board persistence', () => {
  it('does not register a board artifact when its initial durable write fails', async () => {
    installDesignDocument([], null)
    const writeWorkspaceFile = vi.fn(async () => ({ ok: false as const, message: 'disk full' }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })

    await expect(ensureDesignBoardArtifact('/workspace')).resolves.toBeNull()

    expect(useDesignWorkspaceStore.getState().artifacts).toEqual([])
    expect(useDesignWorkspaceStore.getState().fileError).toContain('disk full')
  })
})
