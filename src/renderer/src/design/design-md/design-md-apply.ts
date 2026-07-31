import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { useDesignSystemStore } from '../canvas/design-system-store'
import { resolveTokenPatch, type TokenProp } from '../canvas/design-system-types'
import { designMdTokenForNativeName, mapProjectDesignMdToNative } from './design-md-native-mapping'
import type { ProjectDesignMdDocument } from './design-md-types'

export type ApplyProjectDesignMdResult = { affectedIds: string[] }

/** Applies only token-bound properties; unrelated geometry/content and portal metadata remain untouched. */
export function applyProjectDesignMdToNativeCanvas(document: ProjectDesignMdDocument): ApplyProjectDesignMdResult {
  const designStore = useDesignSystemStore.getState()
  const mapped = mapProjectDesignMdToNative(document, designStore.system)
  designStore.loadSystem(mapped)
  const canvas = useCanvasShapeStore.getState()
  const affectedIds: string[] = []
  useCanvasUndoStore.getState().withGroup('Apply DESIGN.md', () => {
    for (const id of canvas.getAllShapeIds()) {
      const shape = canvas.getShape(id)
      if (!shape?.tokenBindings) continue
      const patch = {}
      let changed = false
      for (const [prop, tokenName] of Object.entries(shape.tokenBindings)) {
        const token = designMdTokenForNativeName(document, tokenName) ?? mapped.tokens[tokenName]
        if (!token) continue
        const resolved = resolveTokenPatch(token, prop as TokenProp, shape)
        if ('error' in resolved) continue
        Object.assign(patch, resolved)
        changed = true
      }
      if (!changed) continue
      canvas.updateShape(id, patch)
      affectedIds.push(id)
    }
  })
  return { affectedIds }
}
