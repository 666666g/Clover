import { describe, expect, it, vi } from 'vitest'
import { createEmptyDocument } from './canvas-types'
import {
  prepareCodeCanvasResend,
  type CodeCanvasResendLiveState
} from './code-canvas-resend'

const liveState: CodeCanvasResendLiveState = {
  currentDocument: createEmptyDocument(),
  currentDocumentKey: 'canvas-key',
  selectedIds: new Set<string>(),
  viewBox: { x: 0, y: 0, width: 1200, height: 800 },
  designContext: { designTarget: 'app' }
}

describe('prepareCodeCanvasResend', () => {
  it('reclassifies an edited Chinese architecture request as a live whiteboard turn', async () => {
    const buildOutboundText = vi.fn(async () => 'enriched whiteboard prompt')
    const text = '\u7ed9\u6211\u8bbe\u8ba1\u4e00\u4e2a\u5f53\u524d\u76ee\u5f55\u7684\u67b6\u6784\u56fe'

    const prepared = await prepareCodeCanvasResend({
      route: 'chat',
      text,
      previousCanvasTurn: false,
      fallbackWorkspaceRoot: '/fallback',
      threadWorkspaceRoot: '/thread-workspace',
      threadId: 'thread-1'
    }, {
      buildOutboundText,
      readLiveState: () => liveState
    })

    expect(prepared).toEqual({
      text: 'enriched whiteboard prompt',
      displayText: text,
      guiDesignCanvas: true
    })
    expect(buildOutboundText).toHaveBeenCalledWith(expect.objectContaining({
      baseText: text,
      canvasBrief: text,
      workspaceRoot: '/thread-workspace',
      threadId: 'thread-1',
      currentDocumentKey: 'canvas-key'
    }))
  })

  it('keeps contextual shape edits on the whiteboard when the original turn was a canvas turn', async () => {
    const buildOutboundText = vi.fn(async () => 'move-node whiteboard prompt')

    const prepared = await prepareCodeCanvasResend({
      route: 'chat',
      text: 'Move this node to the right',
      previousCanvasTurn: true,
      fallbackWorkspaceRoot: '/workspace',
      threadId: 'thread-1'
    }, {
      buildOutboundText,
      readLiveState: () => liveState
    })

    expect(prepared?.guiDesignCanvas).toBe(true)
    expect(buildOutboundText).toHaveBeenCalledTimes(1)
  })

  it('leaves ordinary code edits on the normal chat path', async () => {
    const buildOutboundText = vi.fn(async () => 'unused')

    const prepared = await prepareCodeCanvasResend({
      route: 'chat',
      text: 'Refactor this module and fix the tests',
      previousCanvasTurn: false,
      fallbackWorkspaceRoot: '/workspace',
      threadId: 'thread-1'
    }, {
      buildOutboundText,
      readLiveState: () => liveState
    })

    expect(prepared).toBeNull()
    expect(buildOutboundText).not.toHaveBeenCalled()
  })
})
