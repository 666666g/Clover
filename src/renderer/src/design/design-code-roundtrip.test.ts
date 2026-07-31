import { describe, expect, it, vi } from 'vitest'
import {
  canPrepareImplementDesignTurn,
  dispatchImplementDesignTurn,
  prepareImplementDesignTurn
} from './design-code-roundtrip'
import type { DesignArtifact } from './design-types'
import { createProjectDesignSystem, serializeProjectDesignSystem } from './canvas/project-design-system'

const now = '2026-07-02T00:00:00.000Z'

function artifact(kind: DesignArtifact['kind'] = 'html'): DesignArtifact {
  return {
    id: `${kind}_1`,
    kind,
    title: kind === 'html' ? 'Home' : 'Board',
    relativePath: `.kun-design/doc/${kind}_1/${kind === 'html' ? 'v1.html' : 'canvas.json'}`,
    designMdPath: kind === 'html' ? '.kun-design/doc/html_1/DESIGN.md' : undefined,
    createdAt: now,
    updatedAt: now,
    versions: []
  }
}

const designState = {
  publishDesignSystem: true,
  designContext: { designTarget: 'web' as const },
  implementStackHint: 'React + Tailwind',
  injectIntoCode: true
}

describe('design code roundtrip', () => {
  it('prepares a design-to-code implementation turn from the structured design system', async () => {
    const content = `---\nname: Product UI\ncolors:\n  primary: '#336699'\n---\n# Colors\n`
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/DESIGN.md',
      content,
      size: content.length,
      truncated: false,
      readAt: now
    }))

    const result = await prepareImplementDesignTurn({
      artifact: artifact('html'),
      designState,
      workspaceRoot: '/workspace',
      api: { readWorkspaceFile }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: 'DESIGN.md',
      workspaceRoot: '/workspace'
    }))
    expect(result.designSystemHash).toBeTruthy()
    expect(result.prompt).toContain('Design source (a standalone HTML mockup): .kun-design/doc/html_1/v1.html')
    expect(result.prompt).toContain('Project design system: DESIGN.md')
    expect(result.prompt).toContain('Target stack: React + Tailwind')
    expect(result.prompt).toContain('Read the design notes `.kun-design/doc/html_1/DESIGN.md`')
  })

  it('keeps design-system publish failures non-fatal', async () => {
    const result = await prepareImplementDesignTurn({
      artifact: artifact('html'),
      designState,
      workspaceRoot: '/workspace',
      api: { readWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'nope' })) }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.designSystemHash).toBeUndefined()
    expect(result.prompt).not.toContain('Project design system: DESIGN.md')
  })

  it('rejects non-html artifacts for implementation', async () => {
    const board = artifact('canvas')

    expect(canPrepareImplementDesignTurn(board)).toBe(false)
    await expect(prepareImplementDesignTurn({
      artifact: board,
      designState,
      workspaceRoot: '/workspace'
    })).resolves.toEqual({ ok: false, reason: 'unsupported-artifact' })
  })

  it('dispatches design implementation into a fresh code thread and records provenance', async () => {
    const state = {
      ...designState,
      openImplementPanel: vi.fn(),
      markImplemented: vi.fn()
    }
    const createThread = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => true)

    const result = await dispatchImplementDesignTurn({
      artifact: artifact('html'),
      designState: state,
      workspaceRoot: '/workspace',
      createThread,
      sendMessage,
      displayText: 'Implement Home',
      getActiveThreadId: () => 'thread_1',
      api: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: '/workspace/DESIGN.md',
          content: `---\nname: Product UI\ncolors:\n  primary: '#336699'\n---\n# Colors\n`,
          size: 200,
          truncated: false,
          readAt: now
        }))
      }
    })

    expect(result.status).toBe('sent')
    expect(createThread).toHaveBeenCalledWith({ workspaceRoot: '/workspace' })
    expect(state.openImplementPanel).toHaveBeenCalledWith('Home')
    expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('Design source'), 'agent', {
      displayText: 'Implement Home'
    })
    expect(state.markImplemented).toHaveBeenCalledWith('html_1', 'thread_1', expect.any(String))
  })

  it('does not mark implementation provenance when dispatch send fails', async () => {
    const state = {
      ...designState,
      openImplementPanel: vi.fn(),
      markImplemented: vi.fn()
    }

    const result = await dispatchImplementDesignTurn({
      artifact: artifact('html'),
      designState: state,
      workspaceRoot: '/workspace',
      createThread: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => false),
      displayText: 'Implement Home',
      getActiveThreadId: () => 'thread_1'
    })

    expect(result.status).toBe('send-failed')
    expect(state.openImplementPanel).toHaveBeenCalledWith('Home')
    expect(state.markImplemented).not.toHaveBeenCalled()
  })

})
