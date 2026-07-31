import { clearWorkspaceImageDataUrlCache } from './canvas/canvas-image-source'
import { useCanvasSelectionStore } from './canvas/canvas-selection-store'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { useDesignSystemStore } from './canvas/design-system-store'
import { useImageAnnotationStore } from './canvas/image-annotation-store'
import { flushDesignWorkspacePersistence } from './design-persistence-flush'
import { setDesignPersistenceFailureHandler } from './design-persistence-coordinator'

export function normalizeDesignWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

export function resetDesignWorkspaceTransientStores(): void {
  useCanvasShapeStore.getState().resetDocument()
  useCanvasSelectionStore.getState().clearSelection()
  useDesignSystemStore.getState().resetSystem()
  useImageAnnotationStore.getState().closeImageAnnotation()
}

export function registerDesignPersistenceFailureHandler(options: {
  getWorkspaceRoot: () => string
  setFileError: (message: string) => void
}): void {
  setDesignPersistenceFailureHandler((failure) => {
    if (normalizeDesignWorkspaceRoot(options.getWorkspaceRoot()) !== normalizeDesignWorkspaceRoot(failure.workspaceRoot)) return
    options.setFileError(`Failed to ${failure.operation} ${failure.path}: ${failure.message}`)
  })
}

export function flushAndReleaseDesignWorkspace(workspaceRoot: string): void {
  if (!workspaceRoot) return
  void flushDesignWorkspacePersistence(workspaceRoot)
  clearWorkspaceImageDataUrlCache(workspaceRoot)
}

export function afterFlushingDesignWorkspace(
  workspaceRoot: string,
  action: () => void
): void {
  void flushDesignWorkspacePersistence(workspaceRoot).then(action).catch(() => undefined)
}
