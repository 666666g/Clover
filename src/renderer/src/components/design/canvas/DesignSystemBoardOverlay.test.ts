import { describe, expect, it } from 'vitest'
import { shouldRenderDesignSystemBoard } from './DesignSystemBoardOverlay'

describe('DesignSystemBoardOverlay', () => {
  it('does not create a canvas board when the workspace has no design-system file', () => {
    expect(shouldRenderDesignSystemBoard('loading')).toBe(false)
    expect(shouldRenderDesignSystemBoard('missing')).toBe(false)
  })

  it('renders persisted and invalid design-system files', () => {
    expect(shouldRenderDesignSystemBoard('ready')).toBe(true)
    expect(shouldRenderDesignSystemBoard('invalid')).toBe(true)
    expect(shouldRenderDesignSystemBoard('dirty')).toBe(true)
    expect(shouldRenderDesignSystemBoard('saving')).toBe(true)
    expect(shouldRenderDesignSystemBoard('conflict')).toBe(true)
  })
})
