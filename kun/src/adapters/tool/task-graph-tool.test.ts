import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTaskGraphTool } from './task-graph-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function ctx(threadId = 't1'): ToolHostContext {
  return {
    threadId, turnId: 'tn', workspace: '/ws', approvalPolicy: 'auto',
    abortSignal: new AbortController().signal, awaitApproval: vi.fn(async () => 'allow' as const)
  }
}

describe('task_graph tool', () => {
  const dirs: string[] = []
  afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))))

  it('keeps retry and concurrency policy out of the model schema', () => {
    const tool = createTaskGraphTool()
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>

    expect(properties).not.toHaveProperty('maxAttempts')
    expect(properties).not.toHaveProperty('concurrency')
    expect(properties.action?.enum).not.toContain('set_concurrency')
  })

  it('adds tasks with dependencies and reports runnable set', async () => {
    const tool = createTaskGraphTool()
    await tool.execute({ action: 'add', id: 'a', title: 'A' }, ctx())
    const r = await tool.execute({ action: 'add', id: 'b', title: 'B', dependsOn: ['a'] }, ctx())
    expect(r.output).toMatchObject({ runnable: ['a'] })
  })

  it('advances the plan through start/complete and unblocks dependents', async () => {
    const tool = createTaskGraphTool()
    await tool.execute({ action: 'add', id: 'a', title: 'A' }, ctx())
    await tool.execute({ action: 'add', id: 'b', title: 'B', dependsOn: ['a'] }, ctx())
    await tool.execute({ action: 'start', id: 'a' }, ctx())
    const done = await tool.execute({ action: 'complete', id: 'a' }, ctx())
    expect(done.output).toMatchObject({ runnable: ['b'] })
  })

  it('rejects a dependency cycle', async () => {
    const tool = createTaskGraphTool()
    await tool.execute({ action: 'add', id: 'a', title: 'A', dependsOn: ['b'] }, ctx())
    const r = await tool.execute({ action: 'add', id: 'b', title: 'B', dependsOn: ['a'] }, ctx())
    expect(r.isError).toBe(true)
    expect(String((r.output as Record<string, unknown>).error)).toContain('cycle')
  })

  it('keeps per-thread state isolated', async () => {
    const tool = createTaskGraphTool()
    await tool.execute({ action: 'add', id: 'a', title: 'A' }, ctx('t1'))
    const other = await tool.execute({ action: 'list' }, ctx('t2'))
    expect(other.output).toMatchObject({ tasks: [] })
  })

  it('reports retry on failure with attempts remaining', async () => {
    const tool = createTaskGraphTool({ maxAttempts: 2 })
    await tool.execute({ action: 'add', id: 'a', title: 'A', maxAttempts: 1 }, ctx())
    await tool.execute({ action: 'start', id: 'a' }, ctx())
    const failed = await tool.execute({ action: 'fail', id: 'a', error: 'boom' }, ctx())
    expect(failed.output).toMatchObject({ retried: true })
  })

  it('rejects stale concurrency actions without changing host-owned concurrency', async () => {
    const tool = createTaskGraphTool({ concurrency: 2 })
    await tool.execute({ action: 'add', id: 'a', title: 'A' }, ctx())
    await tool.execute({ action: 'add', id: 'b', title: 'B' }, ctx())
    await tool.execute({ action: 'add', id: 'c', title: 'C' }, ctx())

    const stale = await tool.execute({ action: 'set_concurrency', concurrency: 99 }, ctx())
    const listed = await tool.execute({ action: 'list' }, ctx())

    expect(stale).toMatchObject({ isError: true })
    expect(listed.output).toMatchObject({ runnable: ['a', 'b'] })
  })

  it('restores a thread graph from disk', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'kun-task-graph-'))
    dirs.push(rootDir)
    const tool = createTaskGraphTool({ rootDir })
    await tool.execute({ action: 'add', id: 'a', title: 'A' }, ctx('t1'))
    const restored = await createTaskGraphTool({ rootDir }).execute({ action: 'list' }, ctx('t1'))
    expect(restored.output).toMatchObject({ tasks: [{ id: 'a', title: 'A' }] })
  })
})
