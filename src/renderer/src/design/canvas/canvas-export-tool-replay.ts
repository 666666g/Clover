import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import {
  extractCanvasAgentExportRequest,
  type CanvasAgentExportRequestHandler,
  type CanvasAgentExportResult
} from './canvas-export'

function publishCanvasExportResult(blockId: string, result: CanvasAgentExportResult): void {
  useChatStore.setState((state) => ({
    blocks: state.blocks.map((block) => {
      if (block.kind !== 'tool' || block.id !== blockId) return block
      const current = Array.isArray(block.meta?.generatedFiles)
        ? block.meta.generatedFiles.filter((candidate) => {
            if (!candidate || typeof candidate !== 'object') return false
            return (candidate as { relativePath?: unknown }).relativePath !== result.relativePath
          })
        : []
      return {
        ...block,
        meta: { ...block.meta, generatedFiles: [...current, result] }
      }
    })
  }))
}

function failCanvasExportToolBlock(blockId: string, message: string): void {
  useDesignWorkspaceStore.getState().setFileError(message)
  useChatStore.setState((state) => ({
    blocks: state.blocks.map((block) =>
      block.kind === 'tool' && block.id === blockId
        ? {
            ...block,
            status: 'error' as const,
            summary: 'Whiteboard export failed',
            detail: message,
            meta: { ...block.meta, generatedFiles: [], canvasExportError: message }
          }
        : block
    )
  }))
}

export function dispatchCanvasExportToolBlock(
  block: ToolBlock,
  parsed: unknown,
  appliedBlockIds: Set<string>,
  onRequest?: CanvasAgentExportRequestHandler
): boolean {
  if (block.meta?.toolName !== 'design_export_canvas') return false
  if (appliedBlockIds.has(block.id)) return true
  appliedBlockIds.add(block.id)
  const request = extractCanvasAgentExportRequest(parsed)
  if (!request || !onRequest) {
    failCanvasExportToolBlock(
      block.id,
      request ? 'Whiteboard export is unavailable.' : 'Whiteboard export request is invalid.'
    )
    return true
  }
  void Promise.resolve()
    .then(() => onRequest(request))
    .then((result) => publishCanvasExportResult(block.id, result))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      failCanvasExportToolBlock(block.id, `Whiteboard export failed: ${message}`)
    })
  return true
}

export type { CanvasAgentExportRequestHandler }
