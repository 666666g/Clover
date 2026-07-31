import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument } from '../canvas/canvas-types'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { useDesignSystemStore } from '../canvas/design-system-store'
import { parseProjectDesignMd } from './design-md-adapter'
import { applyProjectDesignMdToNativeCanvas } from './design-md-apply'

describe('Save & Apply DESIGN.md', () => {
  beforeEach(() => {
    const document = createEmptyDocument()
    const shape = createDefaultShape('rect', 10, 20)
    shape.id = 'card'
    shape.parentId = document.rootId
    shape.width = 300
    shape.height = 180
    shape.fills = [{ type: 'solid', color: '#000000', opacity: 1 }]
    shape.strokes = [{ color: '#123456', width: 3, opacity: 1, position: 'center' }]
    shape.tokenBindings = { fill: 'colors.primary' }
    shape.htmlArtifactId = 'html-keep'
    document.objects.card = shape
    document.objects[document.rootId].children.push('card')
    useCanvasShapeStore.getState().loadDocument(document)
    useCanvasUndoStore.getState().clear()
    useDesignSystemStore.getState().resetSystem()
  })

  it('updates bound properties in one undo batch and preserves unrelated shape fields', () => {
    const design = parseProjectDesignMd(`---\nname: Theme\ncolors:\n  primary: '#abcdef'\n---\n# Colors\n`).document!
    const result = applyProjectDesignMdToNativeCanvas(design)
    const shape = useCanvasShapeStore.getState().getShape('card')!
    expect(result.affectedIds).toEqual(['card'])
    expect(shape.fills?.[0]).toMatchObject({ color: '#abcdef' })
    expect(shape.strokes?.[0]).toMatchObject({ color: '#123456', width: 3 })
    expect(shape).toMatchObject({ x: 10, y: 20, width: 300, height: 180, htmlArtifactId: 'html-keep' })
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('does not mutate HTML or SVG portal metadata when no compatible binding exists', () => {
    const before = structuredClone(useCanvasShapeStore.getState().getShape('card'))
    const design = parseProjectDesignMd(`---\nname: Theme\ncolors:\n  accent: '#abcdef'\n---\n# Colors\n`).document!
    expect(applyProjectDesignMdToNativeCanvas(design).affectedIds).toEqual([])
    expect(useCanvasShapeStore.getState().getShape('card')).toEqual(before)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('updates legacy native bindings from Google semantic token names', () => {
    useCanvasShapeStore.getState().updateShape('card', { tokenBindings: { fill: 'brand/primary' } })
    useCanvasUndoStore.getState().clear()
    const design = parseProjectDesignMd(`---\nname: Theme\ncolors:\n  primary: '#fedcba'\n---\n# Colors\n`).document!
    expect(applyProjectDesignMdToNativeCanvas(design).affectedIds).toEqual(['card'])
    expect(useCanvasShapeStore.getState().getShape('card')?.fills?.[0]).toMatchObject({ color: '#fedcba' })
  })
})
