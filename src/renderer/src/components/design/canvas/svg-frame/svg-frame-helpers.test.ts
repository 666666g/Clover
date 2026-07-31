import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, createSvgFrameShape } from '../../../../design/canvas/canvas-types'
import {
  advanceSvgTimeline,
  canvasCornerRadiusCss,
  selectSvgFramesForOverlay,
  shouldShowSvgFrameControls,
  svgFramesInCanvasPaintOrder
} from './svg-frame-helpers'

describe('SVG frame overlay helpers', () => {
  it('stops finite timelines and only wraps indefinite timelines', () => {
    expect(advanceSvgTimeline({
      currentMs: 900,
      elapsedMs: 200,
      rate: 1,
      durationMs: 1_000,
      loopsIndefinitely: false
    })).toEqual({ timeMs: 1_000, ended: true })
    expect(advanceSvgTimeline({
      currentMs: 900,
      elapsedMs: 200,
      rate: 1,
      durationMs: 1_000,
      loopsIndefinitely: true
    })).toEqual({ timeMs: 1_100, ended: false })
  })

  it('uses root child paint order and ignores nested, hidden, and orphan SVG frames', () => {
    const document = createEmptyDocument()
    const first = createSvgFrameShape('First', 0, 0, 'svg-1')
    const second = createSvgFrameShape('Second', 0, 0, 'svg-2')
    const hidden = createSvgFrameShape('Hidden', 0, 0, 'svg-3')
    const nested = createSvgFrameShape('Nested', 0, 0, 'svg-4')
    const group = createDefaultShape('group', 0, 0)
    first.parentId = document.rootId
    second.parentId = document.rootId
    hidden.parentId = document.rootId
    hidden.visible = false
    group.parentId = document.rootId
    group.children = [nested.id]
    nested.parentId = group.id
    document.objects = {
      ...document.objects,
      [first.id]: first,
      [second.id]: second,
      [hidden.id]: hidden,
      [group.id]: group,
      [nested.id]: nested
    }
    document.objects[document.rootId].children = [second.id, group.id, hidden.id, first.id]

    expect(svgFramesInCanvasPaintOrder(document).map((shape) => shape.id)).toEqual([second.id, first.id])
  })

  it('prioritizes selected frames for mounting but returns them in paint order', () => {
    const frames = Array.from({ length: 4 }, (_, index) => createSvgFrameShape(String(index), 0, 0, `svg-${index}`))
    expect(selectSvgFramesForOverlay(frames, new Set([frames[0].id]), 2).map((shape) => shape.id)).toEqual([
      frames[0].id,
      frames[3].id
    ])
  })

  it('scales all four canvas corner radii into CSS pixels', () => {
    expect(canvasCornerRadiusCss([1, 2, 3, 4], 2)).toBe('2px 4px 6px 8px')
  })

  it('shows external controls only for an active unlocked preview', () => {
    expect(shouldShowSvgFrameControls({
      selected: true,
      locked: false,
      panning: false,
      previewReady: true
    })).toBe(true)
    expect(shouldShowSvgFrameControls({
      selected: true,
      locked: true,
      panning: false,
      previewReady: true
    })).toBe(false)
    expect(shouldShowSvgFrameControls({
      selected: false,
      locked: false,
      panning: false,
      previewReady: true
    })).toBe(false)
  })
})
