import { isSvgFrame, type CanvasDocument, type CanvasShape } from '../../../../design/canvas/canvas-types'

export type SvgTimelineAdvance = {
  timeMs: number
  ended: boolean
}

export function advanceSvgTimeline(options: {
  currentMs: number
  elapsedMs: number
  rate: number
  durationMs: number
  loopsIndefinitely: boolean
}): SvgTimelineAdvance {
  const durationMs = Math.max(1, options.durationMs)
  const next = Math.max(0, options.currentMs + Math.max(0, options.elapsedMs) * Math.max(0, options.rate))
  if (options.loopsIndefinitely) {
    // Keep the document clock monotonic. Different indefinite animations may
    // have different periods (for example 2s and 3s); wrapping the whole SVG at
    // the longest period would make the shorter animation jump phase at 3s.
    return { timeMs: next, ended: false }
  }
  return { timeMs: Math.min(durationMs, next), ended: next >= durationMs }
}

/** Artifact frames are root-level portals; root.children is their paint order. */
export function svgFramesInCanvasPaintOrder(document: CanvasDocument): CanvasShape[] {
  const root = document.objects[document.rootId]
  if (!root) return []
  return root.children.flatMap((id) => {
    const shape = document.objects[id]
    return shape && shape.parentId === document.rootId && shape.visible && isSvgFrame(shape) ? [shape] : []
  })
}

export function selectSvgFramesForOverlay(
  framesInPaintOrder: readonly CanvasShape[],
  selectedIds: ReadonlySet<string>,
  maxActive = 24
): CanvasShape[] {
  const priority = framesInPaintOrder
    .map((shape, index) => ({ shape, index, selected: selectedIds.has(shape.id) ? 1 : 0 }))
    .sort((a, b) => b.selected - a.selected || b.index - a.index)
    .slice(0, Math.max(0, maxActive))
  const mounted = new Set(priority.map((item) => item.shape.id))
  return framesInPaintOrder.filter((shape) => mounted.has(shape.id))
}

export function canvasCornerRadiusCss(
  radius: CanvasShape['cornerRadius'],
  zoom: number
): string {
  const values = Array.isArray(radius) ? radius : [radius, radius, radius, radius]
  return values.map((value) => `${Math.max(0, value * zoom)}px`).join(' ')
}

export function shouldShowSvgFrameControls(options: {
  selected: boolean
  locked: boolean
  panning: boolean
  previewReady: boolean
}): boolean {
  return options.selected && !options.locked && !options.panning && options.previewReady
}
