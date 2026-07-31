import { describe, expect, it } from 'vitest'
import { lintProjectDesignMd } from './project-design-md-lint'

describe('project DESIGN.md official lint service', () => {
  it('serializes the official Map-based model into IPC-safe records', () => {
    const result = lintProjectDesignMd(`---\nname: Product\ncolors:\n  primary: '#336699'\nspacing:\n  md: 16px\n---\n# Colors\n`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.colors.primary).toMatchObject({ hex: '#336699' })
    expect(result.spacing.md).toEqual({ value: 16, unit: 'px' })
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ ok: true })
  })

  it('returns structured official findings for invalid input without throwing', () => {
    const result = lintProjectDesignMd(`---\nname: Broken\ncolors:\n  primary: nope\n---\n# Colors\n`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.findings.length).toBeGreaterThan(0)
  })
})
