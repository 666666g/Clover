import { flushPendingCanvasDocuments } from './canvas/canvas-persistence'
import { flushPendingDesignSystems } from './canvas/design-system-persistence'
import { flushPendingDocumentsIndexes } from './design-document-persistence'
import { flushDesignPersistenceQueue } from './design-persistence-coordinator'

/** Flush every debounced Design payload, then wait for all ordered disk work. */
export async function flushDesignWorkspacePersistence(workspaceRoot?: string): Promise<void> {
  await Promise.all([
    flushPendingDocumentsIndexes(workspaceRoot),
    flushPendingCanvasDocuments(workspaceRoot),
    flushPendingDesignSystems(workspaceRoot)
  ])
  await flushDesignPersistenceQueue(workspaceRoot)
}
