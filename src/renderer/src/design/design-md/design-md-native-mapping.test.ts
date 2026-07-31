import { describe, expect, it } from 'vitest'
import { createEmptyDesignSystem } from '../canvas/design-system-types'
import { parseProjectDesignMd } from './design-md-adapter'
import { mapProjectDesignMdToNative } from './design-md-native-mapping'

describe('DESIGN.md native mapping', () => {
  it('maps compatible tokens and preserves rich component trees', () => {
    const parsed = parseProjectDesignMd(`---\nname: x\ncolors:\n  primary: '#336699'\nspacing:\n  md: 1rem\nrounded:\n  sm: 4px\n---\n# Colors`)
    const current = createEmptyDesignSystem()
    current.components.card = { id: 'card', name: 'card', version: 1, tree: [] as never, slots: [] }
    const result = mapProjectDesignMdToNative(parsed.document!, current)
    expect(result.tokens['colors.primary']).toMatchObject({ kind: 'color', value: '#336699' })
    expect(result.tokens['spacing.md']).toMatchObject({ kind: 'space', value: 16 })
    expect(result.components.card).toBe(current.components.card)
  })

  it('keeps existing slash-style bindings synchronized with public semantic tokens', () => {
    const parsed = parseProjectDesignMd(`---\nname: x\ncolors:\n  primary: '#336699'\n---\n# Colors`)
    const current = createEmptyDesignSystem()
    current.tokens['brand/primary'] = { name: 'brand/primary', kind: 'color', value: '#000000' }
    const result = mapProjectDesignMdToNative(parsed.document!, current)
    expect(result.tokens['brand/primary']).toMatchObject({ value: '#336699' })
  })
})
