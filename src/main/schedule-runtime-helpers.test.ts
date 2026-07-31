import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { runPromptViaRuntime } from './schedule-runtime-helpers'

describe('runPromptViaRuntime workspace validation', () => {
  it('rejects a missing custom workspace without creating it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-schedule-workspace-'))
    const workspaceRoot = join(parent, 'missing-project')
    const runtimeRequest = vi.fn()
    try {
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        { agents: { kun: { model: 'test-model' } } } as AppSettingsV1,
        {
          prompt: 'test',
          title: 'test',
          workspaceRoot,
          model: 'test-model',
          reasoningEffort: '',
          mode: 'agent',
          waitForResult: false,
          responseTimeoutMs: 1_000
        }
      )

      expect(result).toEqual({
        ok: false,
        message: `Workspace directory is unavailable: ${workspaceRoot}`
      })
      expect(runtimeRequest).not.toHaveBeenCalled()
      await expect(stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
