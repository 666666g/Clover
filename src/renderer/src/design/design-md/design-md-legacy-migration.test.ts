import { describe, expect, it, vi } from 'vitest'
import { createDefaultShape } from '../canvas/canvas-types'
import { createProjectDesignSystem, serializeProjectDesignSystem } from '../canvas/project-design-system'
import { parseProjectDesignMd } from './design-md-adapter'
import { acceptLegacyDesignSystemMigration, createLegacyDesignSystemMigrationDraft } from './design-md-legacy-migration'
import { useProjectDesignSystemStore } from '../canvas/project-design-system-store'

describe('legacy project design-system migration', () => {
  it('creates a valid non-destructive draft and records retained rich trees', () => {
    const legacy = createProjectDesignSystem('Legacy Kit')
    legacy.tokens['brand/primary'] = { name: 'brand/primary', kind: 'color', value: '#123456' }
    const root = createDefaultShape('frame', 0, 0)
    legacy.components.card = { id: 'card', name: 'Card', version: 1, tree: [root], slots: [] }
    const draft = createLegacyDesignSystemMigrationDraft(serializeProjectDesignSystem(legacy))
    expect(draft).toMatchObject({ tokenCount: 1, preservedComponentNames: ['Card'] })
    expect(parseProjectDesignMd(draft!.content).ok).toBe(true)
    expect(draft!.content).toContain('The legacy file was not modified or deleted.')
    expect(draft!.content).not.toContain('"tree"')
  })

  it('rejects invalid legacy JSON without producing a root file draft', () => {
    expect(createLegacyDesignSystemMigrationDraft('{ nope')).toBeNull()
  })

  it('writes root DESIGN.md only after explicit acceptance and never deletes the legacy source', async () => {
    const legacyDocument = createProjectDesignSystem('Legacy Kit')
    legacyDocument.tokens['brand/primary'] = { name: 'brand/primary', kind: 'color', value: '#123456' }
    const legacy = serializeProjectDesignSystem(legacyDocument)
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const, path: '/workspace/DESIGN.md', savedAt: new Date().toISOString() }))
    const deleteWorkspaceEntry = vi.fn()
    vi.stubGlobal('window', { kunGui: {
      readWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'missing' })),
      writeWorkspaceFile,
      deleteWorkspaceEntry
    } })
    useProjectDesignSystemStore.getState().activateWorkspace('/workspace')
    expect(createLegacyDesignSystemMigrationDraft(legacy)).not.toBeNull()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(await acceptLegacyDesignSystemMigration('/workspace', legacy)).not.toBeNull()
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'DESIGN.md' }))
    expect(deleteWorkspaceEntry).not.toHaveBeenCalled()
  })
})
