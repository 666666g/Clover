import { describe, expect, it } from 'vitest'
import { normalizedCornerRadii, roundedRectPath } from './canvas-rounded-rect'
import { createDefaultShape } from './canvas-types'

describe('canvas rounded rectangles', () => {
  it('preserves four independent corner radii in clockwise order', () => {
    expect(normalizedCornerRadii([4, 8, 12, 16], 100, 80)).toEqual([4, 8, 12, 16])
    expect(roundedRectPath(100, 80, [4, 8, 12, 16])).toContain('Q 100 0 100 8')
    expect(roundedRectPath(100, 80, [4, 8, 12, 16])).toContain('Q 0 80 0 64')
  })

  it('scales oversized radii without overlapping adjacent corners', () => {
    expect(normalizedCornerRadii(80, 100, 40)).toEqual([20, 20, 20, 20])
  })

  it('gives Code whiteboard nodes and connectors theme-aware diagram defaults', () => {
    const rect = createDefaultShape('rect', 0, 0, 'diagram')
    const arrow = createDefaultShape('arrow', 0, 0, 'diagram')

    expect(rect.fills).toEqual([])
    expect(rect.cornerRadius).toBe(16)
    expect(rect.strokes[0]).toMatchObject({ color: 'currentColor', width: 2, dash: 'solid' })
    expect(arrow.strokes[0]).toMatchObject({ color: 'currentColor', width: 2 })
    expect(arrow.arrowheadEnd).toBe('arrow')
  })
})
