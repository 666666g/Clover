import { describe, expect, it } from 'vitest'
import {
  parseProjectDesignMd,
  patchProjectDesignMd,
  resolveDesignMdReference
} from './design-md-adapter'
import { PROJECT_DESIGN_MD_MAX_BYTES } from './design-md-paths'
import {
  INVALID_DESIGN_MD,
  LUMINOUS_STAGE_DESIGN_MD,
  OFFICIAL_STYLE_DESIGN_MD,
  UNSAFE_DESIGN_MD
} from './design-md-fixtures'

const LUMINOUS_STAGE = `---
name: Luminous Stage
colors:
  surface: '#131313'
  primary: '#ffffff'
  secondary: '#e9c349'
  tertiary: '#9d50bb'
typography:
  headline-lg:
    fontFamily: Sora
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
rounded:
  md: 12px
spacing:
  md: 16px
components:
  button:
    background: '{colors.primary}'
x-kun-extension:
  note: preserve me
---
# Brand & Style

Dark editorial stage.

# Colors

Use gold sparingly.
`

describe('DESIGN.md adapter', () => {
  it('parses a Google-style Luminous Stage document into a package-neutral model', () => {
    const result = parseProjectDesignMd(LUMINOUS_STAGE_DESIGN_MD)
    expect(result.ok).toBe(true)
    expect(result.document?.name).toBe('Luminous Stage')
    expect(result.document?.colors.surface.raw).toBe('#131313')
    expect(result.document?.colors.secondary.hex).toBe('#e9c349')
    expect(result.document?.typography['headline-lg'].fontFamily).toBe('Sora')
    expect(result.document?.rounded.DEFAULT.raw).toBe('0.5rem')
    expect(result.document?.sections.map((section) => section.heading)).toEqual([
      'Brand & Style',
      'Colors',
      'Typography',
      'Layout & Spacing',
      'Elevation & Depth',
      'Shapes',
      'Components'
    ])
  })

  it('accepts an official-style example fixture', () => {
    expect(parseProjectDesignMd(OFFICIAL_STYLE_DESIGN_MD).ok).toBe(true)
  })

  it('preserves Markdown prose and unknown YAML while applying a structured patch', () => {
    const result = patchProjectDesignMd(LUMINOUS_STAGE, [{ section: 'colors', key: 'secondary', value: '#d4af37' }])
    expect(result.document?.colors.secondary.raw).toBe('#d4af37')
    expect(result.document?.extensions['x-kun-extension']).toEqual({ note: 'preserve me' })
    expect(result.document?.raw.endsWith('# Colors\n\nUse gold sparingly.\n')).toBe(true)
  })

  it('rejects malformed, duplicate, unsafe, cyclic, oversized, and truncated sources', () => {
    expect(parseProjectDesignMd('name: missing fence').ok).toBe(false)
    expect(parseProjectDesignMd(UNSAFE_DESIGN_MD).ok).toBe(false)
    expect(parseProjectDesignMd(INVALID_DESIGN_MD).ok).toBe(false)
    expect(parseProjectDesignMd('---\nname: x\n---\n# Colors\na\n# Colors\nb').ok).toBe(false)
    expect(parseProjectDesignMd(`---\nname: x\ndescription: '${'x'.repeat(PROJECT_DESIGN_MD_MAX_BYTES)}'\n---`).ok).toBe(false)
    expect(parseProjectDesignMd(LUMINOUS_STAGE, { truncated: true }).ok).toBe(false)
    expect(() => resolveDesignMdReference({ colors: { a: '{colors.b}', b: '{colors.a}' } }, '{colors.a}')).toThrow(/Circular/)
  })
})
