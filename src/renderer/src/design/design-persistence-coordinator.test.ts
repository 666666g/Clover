import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileWriteResult } from '@shared/workspace-file'
import {
  clearDesignPersistenceCoordinatorForTests,
  flushDesignPersistenceQueue,
  setDesignPersistenceFailureHandler,
  writeDesignWorkspaceFile
} from './design-persistence-coordinator'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

afterEach(() => {
  clearDesignPersistenceCoordinatorForTests()
})

describe('design persistence coordinator', () => {
  it('publishes resolved and thrown write failures', async () => {
    const failures = vi.fn()
    setDesignPersistenceFailureHandler(failures)
    const resolvedApi = {
      writeWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'disk full' }))
    }
    const thrownApi = {
      writeWorkspaceFile: vi.fn(async () => {
        throw new Error('bridge down')
      })
    }

    await expect(writeDesignWorkspaceFile({
      workspaceRoot: '/workspace',
      path: '.kun-design/a.json',
      content: 'a'
    }, resolvedApi)).resolves.toEqual({ ok: false, message: 'disk full' })
    await expect(writeDesignWorkspaceFile({
      workspaceRoot: '/workspace',
      path: '.kun-design/b.json',
      content: 'b'
    }, thrownApi)).resolves.toEqual({ ok: false, message: 'bridge down' })

    expect(failures).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operation: 'write',
      path: '.kun-design/a.json',
      message: 'disk full'
    }))
    expect(failures).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'write',
      path: '.kun-design/b.json',
      message: 'bridge down'
    }))
  })

  it('orders writes to the same path while allowing another path to proceed', async () => {
    const first = deferred<WorkspaceFileWriteResult>()
    const calls: string[] = []
    const api = {
      writeWorkspaceFile: vi.fn(async (payload: { path: string; content: string }) => {
        calls.push(`${payload.path}:${payload.content}`)
        if (payload.content === 'first') return first.promise
        return { ok: true as const, path: payload.path, savedAt: 'now' }
      })
    }

    const firstWrite = writeDesignWorkspaceFile({
      workspaceRoot: '/workspace', path: 'same.json', content: 'first'
    }, api)
    const secondWrite = writeDesignWorkspaceFile({
      workspaceRoot: '/workspace', path: 'same.json', content: 'second'
    }, api)
    const otherWrite = writeDesignWorkspaceFile({
      workspaceRoot: '/workspace', path: 'other.json', content: 'other'
    }, api)

    await otherWrite
    expect(calls).toEqual(['same.json:first', 'other.json:other'])
    first.resolve({ ok: true, path: 'same.json', savedAt: 'now' })
    await Promise.all([firstWrite, secondWrite])
    expect(calls).toEqual(['same.json:first', 'other.json:other', 'same.json:second'])
  })

  it('flushes all queued writes for a workspace', async () => {
    const pending = deferred<WorkspaceFileWriteResult>()
    const api = { writeWorkspaceFile: vi.fn(() => pending.promise) }
    void writeDesignWorkspaceFile({
      workspaceRoot: '/workspace', path: 'pending.json', content: 'pending'
    }, api)
    const flushed = flushDesignPersistenceQueue('/workspace')
    let settled = false
    void flushed.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    pending.resolve({ ok: true, path: 'pending.json', savedAt: 'now' })
    await flushed
    expect(settled).toBe(true)
  })
})
