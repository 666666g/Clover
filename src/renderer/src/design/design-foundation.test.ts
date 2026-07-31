import { describe, expect, it } from 'vitest'
import {
  buildDesignLogoPrompt,
  buildDesignSpecPrompt,
  buildDesignSpecStub,
  buildFoundationFollowLines,
  designSpecPath,
  findFoundationArtifact
} from './design-foundation'
import type { DesignArtifact } from './design-types'
import { PROJECT_DESIGN_SYSTEM_PATH } from './canvas/project-design-system'

function artifact(partial: Partial<DesignArtifact> & { id: string }): DesignArtifact {
  const createdAt = '2026-01-01T00:00:00.000Z'
  return {
    kind: 'html',
    title: partial.id,
    relativePath: `.kun-design/doc/${partial.id}/v1.html`,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${partial.id}-v1`, relativePath: `.kun-design/doc/${partial.id}/v1.html`, createdAt, summary: '' }],
    ...partial
  }
}

describe('designSpecPath', () => {
  it('places design.md under the 设计稿 directory', () => {
    expect(designSpecPath('abc123')).toBe('.kun-design/abc123/design.md')
  })
})

describe('buildDesignSpecStub', () => {
  it('is a markdown brief that embeds the raw brief text', () => {
    const stub = buildDesignSpecStub('A fan site for IKUN')
    expect(stub).toContain('# Design brief')
    expect(stub).toContain('A fan site for IKUN')
    expect(stub).toContain('Information architecture')
    expect(stub).toContain('State & responsiveness plan')
    expect(stub).toContain('Implementation notes')
  })
})

describe('buildDesignSpecPrompt', () => {
  const prompt = buildDesignSpecPrompt({
    brief: 'An IKUN fan hub',
    workspaceRoot: '/ws',
    designMdPath: '.kun-design/doc/design.md',
    existingPages: [{ name: 'Home', htmlPath: '.kun-design/doc/home/v1.html', summary: 'landing' }]
  })

  it('writes design.md first, then requires a parseable pages block', () => {
    expect(prompt).toContain('.kun-design/doc/design.md')
    expect(prompt).toContain('Design target: Web')
    expect(prompt).toContain('1280x800 desktop page frame')
    expect(prompt).toContain('Web brief:')
    expect(prompt).not.toContain('App idea:')
    expect(prompt).toContain('```pages')
    expect(prompt).toContain('REQUIRED')
    expect(prompt).toContain('State & responsiveness plan')
    expect(prompt).toContain('primary action')
  })

  it('restricts edits to design.md and forbids designing screens yet', () => {
    expect(prompt).toContain('Modify ONLY `.kun-design/doc/design.md`')
    expect(prompt).toContain('do NOT design screens yet')
  })

  it('lists existing canvas pages so they are not duplicated', () => {
    expect(prompt).toContain('do NOT duplicate')
    expect(prompt).toContain('"Home"')
  })

  it('plans app foundations around mobile app prototype screens', () => {
    const appPrompt = buildDesignSpecPrompt({
      brief: 'A habit tracker',
      workspaceRoot: '/ws',
      designMdPath: '.kun-design/doc/design.md',
      designContext: { designTarget: 'app' }
    })

    expect(appPrompt).toContain('Design target: App')
    expect(appPrompt).toContain('390x844 phone screens')
    expect(appPrompt).toContain('primary touch action')
    expect(appPrompt).toContain('App idea:')
    expect(appPrompt).not.toContain('Web brief:')
  })
})

describe('buildDesignLogoPrompt', () => {
  const prompt = buildDesignLogoPrompt({
    brief: 'An IKUN fan hub',
    workspaceRoot: '/ws',
    artifactRelativePath: '.kun-design/doc/logo/v1.html',
    designSystemMdPath: PROJECT_DESIGN_SYSTEM_PATH,
    designContext: { brandColor: '#d4af37' }
  })

  it('lets the agent choose inline SVG or a generated raster', () => {
    expect(prompt).toContain('.kun-design/doc/logo/v1.html')
    expect(prompt).toContain('inline SVG')
    expect(prompt).toContain('generate_image')
  })

  it('honors the brand color from the design context', () => {
    expect(prompt).toContain('#d4af37')
  })
})

describe('findFoundationArtifact', () => {
  const artifacts = [
    artifact({ id: 'page1' }),
    artifact({ id: 'sys', role: 'design-system' }),
    artifact({ id: 'logo', role: 'logo' })
  ]

  it('finds the artifact carrying the requested role', () => {
    expect(findFoundationArtifact(artifacts, 'design-system')?.id).toBe('sys')
    expect(findFoundationArtifact(artifacts, 'logo')?.id).toBe('logo')
  })

  it('returns undefined when no artifact has the role', () => {
    expect(findFoundationArtifact([artifact({ id: 'page1' })], 'logo')).toBeUndefined()
  })
})

describe('buildFoundationFollowLines', () => {
  it('is empty when no foundation paths exist', () => {
    expect(buildFoundationFollowLines({})).toEqual([])
  })

  it('points pages at the brief, tokens, and on-canvas siblings', () => {
    const lines = buildFoundationFollowLines({
      designMdPath: '.kun-design/doc/design.md',
      designSystemMdPath: PROJECT_DESIGN_SYSTEM_PATH
    }).join('\n')
    expect(lines).toContain('.kun-design/doc/design.md')
    expect(lines).toContain(PROJECT_DESIGN_SYSTEM_PATH)
    expect(lines).toContain('reuse its exact tokens, component trees, slots, and variants')
    expect(lines).toContain('existing project foundation')
  })
})
