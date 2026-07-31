import { describe, expect, it } from 'vitest'
import { buildDesignTurnPrompt } from './entry'

describe('SVG design turn prompt', () => {
  it('routes the agent through the structured SVG inspection, editing, animation, and validation tools', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'svg',
      mode: 'text',
      text: 'Create a looping orbit loader with a subtle path draw.',
      artifactRelativePath: '.kun-design/doc/motion/v1.svg',
      designNotesPath: '.kun-design/doc/motion/DESIGN.md',
      workspaceRoot: '/workspace',
      designContext: { designTarget: 'web', brandColor: '#7c3aed' }
    })

    expect(prompt).toContain('design_svg_inspect')
    expect(prompt).toContain('design_svg_edit')
    expect(prompt).toContain('design_svg_animate')
    expect(prompt).toContain('design_svg_validate')
    expect(prompt).toContain('Never add scripts')
    expect(prompt).toContain('Do not create an HTML page, raster image, or ShapeOps recreation')
    expect(prompt).toContain('.kun-design/doc/motion/v1.svg')
    expect(prompt).toContain('Create a looping orbit loader')
  })

  it('names the previous SVG version when iterating', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'svg',
      mode: 'text',
      text: 'Slow the pulse down.',
      artifactRelativePath: '.kun-design/doc/motion/v2.svg',
      basePath: '.kun-design/doc/motion/v1.svg',
      workspaceRoot: '/workspace'
    })
    expect(prompt).toContain('ITERATE on an existing standalone SVG motion artifact')
    expect(prompt).toContain('Previous version to preserve and improve: .kun-design/doc/motion/v1.svg')
  })
})
