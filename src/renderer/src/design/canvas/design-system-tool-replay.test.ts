import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectDesignSystemStore } from './project-design-system-store'
import { designSystemToolRevisionError } from './design-system-tool-replay'

describe('design_system replay revision guard', () => {
  beforeEach(() => {
    useProjectDesignSystemStore.getState().activateWorkspace('/workspace')
    useProjectDesignSystemStore.setState({ sourceHash: 'current-hash', status: 'ready' })
  })

  it('requires the exact hash for mutations when DESIGN.md exists', () => {
    expect(designSystemToolRevisionError('design_system', { operation: 'update' })?.message).toContain('expectedHash')
    expect(designSystemToolRevisionError('design_system', { operation: 'update', expectedHash: 'stale' })?.message).toContain('changed')
    expect(designSystemToolRevisionError('design_system', { operation: 'update', expectedHash: 'current-hash' })).toBeNull()
  })

  it('allows validation and unrelated canvas tools without a mutation hash', () => {
    expect(designSystemToolRevisionError('design_system', { operation: 'validate' })).toBeNull()
    expect(designSystemToolRevisionError('design_update_shapes', {})).toBeNull()
  })
})
