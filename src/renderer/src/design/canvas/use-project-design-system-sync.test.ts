import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignSystemStore } from './design-system-store'
import { useProjectDesignSystemStore } from './project-design-system-store'
import {
  persistNativeDesignSystemToProjectDesignMd,
  projectDesignMdExternalRevisionDecision,
  saveProjectDesignMd
} from './use-project-design-system-sync'
import { projectDesignMdHash } from '../design-md/design-md-adapter'

const VALID = `---\nname: Test\ncolors:\n  primary: '#336699'\n---\n# Colors\n`
const NEXT = VALID.replace('#336699', '#112233')

function installApi(options: {
  content?: string
  readOk?: boolean
  writeOk?: boolean
  writeGate?: Promise<void>
} = {}) {
  let content = options.content ?? VALID
  const readWorkspaceFile = vi.fn(async () => options.readOk === false
    ? { ok: false as const, message: 'missing' }
    : { ok: true as const, path: '/workspace/DESIGN.md', content, size: content.length, truncated: false, readAt: new Date().toISOString() })
  const writeWorkspaceFile = vi.fn(async (payload: { content: string }) => {
    await options.writeGate
    if (options.writeOk === false) return { ok: false as const, message: 'write failed' }
    content = payload.content
    return { ok: true as const, path: '/workspace/DESIGN.md', bytesWritten: payload.content.length }
  })
  vi.stubGlobal('window', { kunGui: { readWorkspaceFile, writeWorkspaceFile } })
  return { readWorkspaceFile, writeWorkspaceFile, content: () => content }
}

describe('root DESIGN.md persistence', () => {
  beforeEach(() => {
    useProjectDesignSystemStore.getState().activateWorkspace('/workspace')
    useProjectDesignSystemStore.getState().setMissing()
    useDesignSystemStore.getState().resetSystem()
  })

  it('writes a valid draft only when the expected source hash still matches', async () => {
    const api = installApi()
    expect(await saveProjectDesignMd('/workspace', NEXT, projectDesignMdHash(VALID))).toBe(true)
    expect(api.writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(useProjectDesignSystemStore.getState().document?.colors.primary.raw).toBe('#112233')
  })

  it('rejects stale revisions without writing', async () => {
    const api = installApi()
    expect(await saveProjectDesignMd('/workspace', NEXT, 'stale')).toBe(false)
    expect(api.writeWorkspaceFile).not.toHaveBeenCalled()
    expect(useProjectDesignSystemStore.getState().status).toBe('conflict')
  })

  it('coalesces identical concurrent saves', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const api = installApi({ writeGate: gate })
    const first = saveProjectDesignMd('/workspace', NEXT, projectDesignMdHash(VALID))
    const second = saveProjectDesignMd('/workspace', NEXT, projectDesignMdHash(VALID))
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(api.writeWorkspaceFile).toHaveBeenCalledTimes(1)
  })

  it('rolls back to a dirty draft when writing fails', async () => {
    installApi({ writeOk: false })
    expect(await saveProjectDesignMd('/workspace', NEXT, projectDesignMdHash(VALID))).toBe(false)
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ status: 'dirty', draft: { content: NEXT, dirty: true } })
  })

  it('does not let a stale save mutate a newly activated workspace', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    installApi({ writeGate: gate })
    const saving = saveProjectDesignMd('/workspace', NEXT, projectDesignMdHash(VALID))
    useProjectDesignSystemStore.getState().activateWorkspace('/other')
    release()
    await expect(saving).resolves.toBe(false)
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ workspaceRoot: '/other', status: 'loading', document: null })
  })

  it('creates root DESIGN.md only through an explicit design-system persistence call', async () => {
    const api = installApi({ readOk: false })
    useDesignSystemStore.getState().setToken({ name: 'colors.primary', kind: 'color', value: '#abcdef' })
    expect(api.writeWorkspaceFile).not.toHaveBeenCalled()
    expect(await persistNativeDesignSystemToProjectDesignMd('/workspace')).toBe(true)
    expect(api.writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(api.content()).toMatch(/primary: ["']#abcdef["']/)
  })

  it('keeps unsaved drafts on watcher base replays and flags real external revisions', () => {
    const draft = { dirty: true, baseHash: 'base' }
    expect(projectDesignMdExternalRevisionDecision(draft, 'base')).toBe('ignore-base-replay')
    expect(projectDesignMdExternalRevisionDecision(draft, 'changed')).toBe('conflict')
    expect(projectDesignMdExternalRevisionDecision(null, 'changed')).toBe('apply')
  })
})
