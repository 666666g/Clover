import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { dispatchCanvasExportToolBlock } from './canvas-export-tool-replay'

const block: ToolBlock = {
  kind: 'tool',
  id: 'tool-export-1',
  summary: 'design_export_canvas',
  status: 'success',
  detail: '{}',
  meta: {
    toolName: 'design_export_canvas',
    generatedFiles: [{ relativePath: '.deepseekgui-images/architecture.png' }]
  }
}

const parsed = {
  exportRequest: {
    format: 'png',
    fileName: 'architecture.png',
    relativePath: '.deepseekgui-images/architecture.png'
  }
}

describe('canvas export tool replay', () => {
  beforeEach(() => {
    useChatStore.setState({ blocks: [block] })
    useDesignWorkspaceStore.setState({ fileError: null })
  })

  it('publishes the saved file preview after the renderer export succeeds', async () => {
    const onRequest = vi.fn(async () => ({
      name: 'architecture.png',
      relativePath: '.deepseekgui-images/architecture.png',
      absolutePath: '/workspace/.deepseekgui-images/architecture.png',
      mimeType: 'image/png' as const,
      byteSize: 128,
      previewUrl: 'data:image/png;base64,aW1hZ2U='
    }))
    const applied = new Set<string>()

    expect(dispatchCanvasExportToolBlock(block, parsed, applied, onRequest)).toBe(true)
    expect(applied).toEqual(new Set([block.id]))
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledWith(parsed.exportRequest))
    await vi.waitFor(() => {
      const updated = useChatStore.getState().blocks[0]
      expect(updated.kind === 'tool' ? updated.meta?.generatedFiles : undefined).toEqual([
        expect.objectContaining({
          relativePath: '.deepseekgui-images/architecture.png',
          previewUrl: 'data:image/png;base64,aW1hZ2U='
        })
      ])
    })
  })

  it('marks malformed renderer export requests as failed', () => {
    expect(dispatchCanvasExportToolBlock(block, {}, new Set(), vi.fn())).toBe(true)
    const updated = useChatStore.getState().blocks[0]
    expect(updated).toMatchObject({
      kind: 'tool',
      status: 'error',
      summary: 'Whiteboard export failed',
      detail: 'Whiteboard export request is invalid.'
    })
    expect(useDesignWorkspaceStore.getState().fileError).toBe('Whiteboard export request is invalid.')
  })
})
