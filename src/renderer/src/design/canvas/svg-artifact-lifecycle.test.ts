import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultShape, createEmptyDocument, isSvgFrame } from './canvas-types'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { buildSvgArtifactSkeleton, createLinkedSvgArtifact } from './svg-artifact-lifecycle'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { artifact, installDesignDocument } from '../design-board.test-helpers'

const realPrepareSvgTurn = useDesignWorkspaceStore.getState().prepareSvgTurn

describe('first-class SVG artifact lifecycle', () => {
  const files = new Map<string, string>()
  const writeWorkspaceFile = vi.fn(async ({ path }: { path: string; content: string; workspaceRoot: string }) => ({
    ok: true as const,
    path,
    savedAt: '2026-07-10T00:00:00.000Z'
  }))
  const createWorkspaceFile = vi.fn(async ({ path, content }: { path: string; content?: string; workspaceRoot: string }) => {
    if (files.has(path)) return { ok: false as const, message: 'File already exists.' }
    files.set(path, content ?? '')
    return { ok: true as const, path, createdAt: '2026-07-10T00:00:00.000Z' }
  })
  const readWorkspaceFile = vi.fn(async ({ path }: { path: string; workspaceRoot: string }) => {
    const content = files.get(path)
    return content === undefined
      ? { ok: false as const, message: 'missing' }
      : { ok: true as const, path, content, size: content.length, truncated: false }
  })
  const listWorkspaceDirectory = vi.fn(async ({ path }: { path?: string; workspaceRoot: string }) => ({
    ok: true as const,
    path: path ?? '',
    entries: [...files.keys()]
      .filter((file) => file.startsWith(`${path}/`) && !file.slice((path?.length ?? 0) + 1).includes('/'))
      .map((file) => ({ name: file.slice((path?.length ?? 0) + 1), path: file, type: 'file' as const, ext: '.svg' }))
  }))

  beforeEach(() => {
    files.clear()
    writeWorkspaceFile.mockClear()
    createWorkspaceFile.mockClear()
    readWorkspaceFile.mockClear()
    listWorkspaceDirectory.mockClear()
    vi.stubGlobal('window', {
      kunGui: {
        writeWorkspaceFile,
        createWorkspaceFile,
        readWorkspaceFile,
        listWorkspaceDirectory,
        deleteWorkspaceEntry: vi.fn(async () => ({ ok: true as const }))
      }
    })
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
    useCanvasUndoStore.getState().clear()
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasViewportStore.getState().setContainerSize(1200, 800)
    useCanvasViewportStore.getState().setVbox({ x: -600, y: -400, width: 1200, height: 800 })
    useDesignWorkspaceStore.setState({ prepareSvgTurn: realPrepareSvgTurn })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reserves an SVG file, creates a linked frame, and writes an accessible skeleton', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const created = await createLinkedSvgArtifact({
      boardArtifactId: board.id,
      name: 'Orbit loader',
      brief: 'A calm looping orbit animation',
      width: 320,
      height: 240
    })

    expect(created).not.toBeNull()
    const result = created!
    const state = useDesignWorkspaceStore.getState()
    const motion = state.artifacts.find((item) => item.id === result.artifactId)
    const frame = useCanvasShapeStore.getState().document.objects[result.shape.id]
    expect(state.activeArtifactId).toBe(board.id)
    expect(motion).toMatchObject({
      kind: 'svg',
      title: 'Orbit loader',
      relativePath: expect.stringMatching(/^\.kun-design\/doc\/.+\/v1\.svg$/),
      designMdPath: expect.stringMatching(/^\.kun-design\/doc\/.+\/DESIGN\.md$/),
      node: { width: 320, height: 240, sizeMode: 'manual', viewMode: 'preview' }
    })
    expect(frame && isSvgFrame(frame)).toBe(true)
    expect(frame).toMatchObject({
      embeddedArtifact: { id: result.artifactId, kind: 'svg' },
      width: 320,
      height: 240,
      clipContent: true
    })
    expect(useCanvasSelectionStore.getState().selectedIds.has(frame.id)).toBe(true)

    expect(createWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: result.relativePath,
      workspaceRoot: '/workspace',
      content: expect.stringContaining('<g id="artwork" />')
    }))
    const svgWrite = createWorkspaceFile.mock.calls.find(([payload]) => payload.path === result.relativePath)?.[0]
    expect(svgWrite?.content).toContain('viewBox="0 0 320 240"')
    expect(svgWrite?.content).toContain('<title id="title">Orbit loader</title>')
  })

  it('converts a selected empty frame into the SVG artifact frame instead of stacking a new frame', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)
    const frame = createDefaultShape('frame', 80, 120)
    frame.width = 480
    frame.height = 300
    useCanvasShapeStore.getState().addShape(frame)

    const created = await createLinkedSvgArtifact({
      boardArtifactId: board.id,
      targetFrameId: frame.id,
      name: 'Animated mark',
      brief: 'Animate the existing mark frame'
    })

    expect(created?.shape.id).toBe(frame.id)
    expect(Object.values(useCanvasShapeStore.getState().document.objects).filter(isSvgFrame)).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[frame.id]).toMatchObject({
      x: 80,
      y: 120,
      width: 480,
      height: 300,
      embeddedArtifact: { id: created?.artifactId, kind: 'svg' }
    })
  })

  it('preserves an explicitly requested 64px SVG size', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const created = await createLinkedSvgArtifact({
      boardArtifactId: board.id,
      name: 'Tiny loader',
      brief: 'A compact 64px loading mark',
      width: 64,
      height: 64
    })

    expect(created).not.toBeNull()
    const result = created!
    const motion = useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === result.artifactId)
    const frame = useCanvasShapeStore.getState().document.objects[result.shape.id]
    expect(motion?.node).toMatchObject({ width: 64, height: 64 })
    expect(frame).toMatchObject({ width: 64, height: 64 })
    expect(createWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: result.relativePath,
      content: expect.stringContaining('viewBox="0 0 64 64"')
    }))
  })

  it('replays a stable artifact id without creating a second artifact, file, or frame', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const first = await createLinkedSvgArtifact({
      boardArtifactId: board.id,
      artifactId: 'svg-stable-replay',
      name: 'Stable loader',
      brief: 'Reserve this loader exactly once'
    })
    const replay = await createLinkedSvgArtifact({
      boardArtifactId: board.id,
      artifactId: 'svg-stable-replay',
      name: 'Stable loader',
      brief: 'Reserve this loader exactly once'
    })

    expect(first).toMatchObject({ newlyCreated: true, versionCreated: true })
    expect(replay).toMatchObject({
      artifactId: first?.artifactId,
      newlyCreated: false,
      versionCreated: false,
      shape: { id: first?.shape.id }
    })
    expect(useDesignWorkspaceStore.getState().artifacts.filter((item) => item.id === first?.artifactId)).toHaveLength(1)
    expect(Object.values(useCanvasShapeStore.getState().document.objects).filter(isSvgFrame)).toHaveLength(1)
    expect(createWorkspaceFile.mock.calls.filter(([payload]) => payload.path === first?.relativePath)).toHaveLength(1)
  })

  it('does not create an artifact or mutate a reusable frame when the initial SVG write fails', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)
    const frame = createDefaultShape('frame', 80, 120)
    useCanvasShapeStore.getState().addShape(frame)
    createWorkspaceFile.mockResolvedValueOnce({ ok: false, message: 'disk full' })

    await expect(createLinkedSvgArtifact({
      boardArtifactId: board.id,
      artifactId: 'svg-write-failure',
      targetFrameId: frame.id,
      name: 'Unavailable loader'
    })).rejects.toThrow('Could not create SVG file')

    expect(useDesignWorkspaceStore.getState().artifacts.some((item) => item.id === 'svg-write-failure')).toBe(false)
    const unchangedFrame = useCanvasShapeStore.getState().document.objects[frame.id]
    expect(unchangedFrame).toMatchObject({ type: 'frame' })
    expect(unchangedFrame).not.toHaveProperty('embeddedArtifact')
    expect(Object.values(useCanvasShapeStore.getState().document.objects).filter(isSvgFrame)).toHaveLength(0)
  })

  it('does not create a frame if the active design board changes after preparation', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)
    useDesignWorkspaceStore.setState({
      prepareSvgTurn: vi.fn(async () => {
        const otherBoard = artifact('other-board', 'canvas')
        installDesignDocument([otherBoard], otherBoard.id)
        return {
          artifactId: 'svg-context-guard',
          relativePath: '.kun-design/doc/svg-context-guard/v1.svg',
          designMdPath: '.kun-design/doc/svg-context-guard/DESIGN.md',
          newlyCreated: true,
          versionCreated: true
        }
      })
    })

    await expect(createLinkedSvgArtifact({
      boardArtifactId: board.id,
      artifactId: 'svg-context-guard',
      name: 'Guarded SVG'
    })).rejects.toThrow('active workspace or design board changed')

    expect(Object.values(useCanvasShapeStore.getState().document.objects).filter(isSvgFrame)).toHaveLength(0)
  })

  it('escapes user text in the standalone SVG skeleton', () => {
    const source = buildSvgArtifactSkeleton({
      title: '<Logo & mark>',
      brief: 'Use "motion" safely',
      width: 128,
      height: 128
    })
    expect(source).toContain('&lt;Logo &amp; mark&gt;')
    expect(source).toContain('Use &quot;motion&quot; safely')
    expect(source).not.toContain('<script')
  })
})
