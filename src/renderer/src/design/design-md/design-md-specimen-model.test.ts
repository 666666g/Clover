import { describe, expect, it } from 'vitest'
import { parseProjectDesignMd } from './design-md-adapter'
import { LUMINOUS_STAGE_DESIGN_MD } from './design-md-fixtures'
import { buildDesignMdSpecimenModel, readableDesignMdTextColor } from './design-md-specimen-model'

describe('DESIGN.md specimen model', () => {
  it('selects Google semantic roles and retains supplemental colors deterministically', () => {
    const document = parseProjectDesignMd(LUMINOUS_STAGE_DESIGN_MD).document!
    const model = buildDesignMdSpecimenModel(document)
    expect(model.palettes.slice(0, 4).map((item) => item.name)).toEqual(['primary', 'secondary', 'tertiary', 'surface'])
    expect(model.palettes).toHaveLength(Object.keys(document.colors).length)
    expect(model.surface).toBe('#131313')
    expect(model.typographyNames).toEqual([...model.typographyNames].sort())
  })

  it('uses stable fallbacks for sparse arbitrary token names', () => {
    const document = parseProjectDesignMd(`---\nname: Sparse\ncolors:\n  brand-z: '#010203'\n  accent-a: '#fafafa'\n---\n# Colors\n`).document!
    const model = buildDesignMdSpecimenModel(document)
    expect(model.palettes.map((item) => item.name)).toEqual(['brand-z', 'accent-a'])
    expect(model.primary).toBe('#010203')
    expect(model.secondary).toBe('#fafafa')
  })

  it('never emits unsafe text-color values from malformed colors', () => {
    expect(readableDesignMdTextColor('url(javascript:x)')).toBe('#111827')
  })
})
