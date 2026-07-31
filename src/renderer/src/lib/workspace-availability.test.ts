import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  showWorkspaceMissingDialog,
  workspaceDirectoryExists
} from './workspace-availability'

describe('workspace availability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the directory state reported by the main process', async () => {
    const exists = vi.fn(async () => false)
    vi.stubGlobal('window', { kunGui: { workspaceDirectoryExists: exists } })

    await expect(workspaceDirectoryExists('E:\\missing-project')).resolves.toBe(false)
    expect(exists).toHaveBeenCalledWith('E:\\missing-project')
  })

  it('fails closed when the desktop bridge cannot check the directory', async () => {
    vi.stubGlobal('window', { kunGui: { platform: 'win32' } })

    await expect(workspaceDirectoryExists('E:\\missing-project')).resolves.toBe(false)
  })

  it('does not try to show a native dialog outside the renderer', async () => {
    await expect(showWorkspaceMissingDialog('/missing-project')).resolves.toBeUndefined()
  })

  it('shows a one-button warning with the missing path', async () => {
    const alertDialog = vi.fn(async () => undefined)
    vi.stubGlobal('window', { kunGui: { alertDialog } })

    await showWorkspaceMissingDialog('E:\\missing-project')

    expect(alertDialog).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('E:\\missing-project')
    }))
  })
})
