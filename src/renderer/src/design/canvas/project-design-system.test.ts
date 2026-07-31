import { describe, expect, it } from 'vitest'
import { createDefaultShape } from './canvas-types'
import {
  PROJECT_DESIGN_SYSTEM_PATH,
  createProjectDesignSystem,
  parseProjectDesignSystem,
  projectDesignSystemFromSystem,
  serializeProjectDesignSystem
} from './project-design-system'

describe('project design system v1', () => {
  it('uses one canonical project-level path and round-trips an empty document', () => {
    expect(PROJECT_DESIGN_SYSTEM_PATH).toBe('.kun-design/design-system.json')
    const document = createProjectDesignSystem('Kun Product')
    const parsed = parseProjectDesignSystem(serializeProjectDesignSystem(document))
    expect(parsed).toMatchObject({ ok: true, document: { schemaVersion: 1, meta: { name: 'Kun Product' } } })
  })

  it('accepts a normalized full component tree with variant overrides', () => {
    const root = createDefaultShape('frame', 0, 0)
    root.name = 'Button'
    const label = createDefaultShape('text', 12, 10)
    label.name = 'label'
    label.parentId = root.id
    label.textContent = 'Continue'
    root.children = [label.id]
    const document = projectDesignSystemFromSystem({
      tokens: { 'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' } },
      components: {
        Button: {
          id: 'component/button',
          name: 'Button',
          version: 1,
          tree: [root, label],
          slots: [{ path: 'label', kind: 'text' }],
          variantAxes: { size: { values: ['sm', 'md'], defaultValue: 'md' } },
          variants: {
            'size=sm': {
              selection: { size: 'sm' },
              overrides: { [root.id]: { width: 96, height: 36 } }
            }
          }
        }
      }
    })
    expect(parseProjectDesignSystem(serializeProjectDesignSystem(document)).ok).toBe(true)
  })

  it('rejects legacy files, runtime portal fields, and structural variant overrides', () => {
    expect(parseProjectDesignSystem('{"tokens":{},"components":{}}').ok).toBe(false)
    const root = createDefaultShape('frame', 0, 0)
    root.htmlArtifactId = 'page'
    const document = projectDesignSystemFromSystem({
      tokens: {},
      components: {
        Bad: {
          id: 'bad',
          name: 'Bad',
          version: 1,
          tree: [root],
          slots: [],
          variants: {
            broken: { selection: {}, overrides: { [root.id]: { id: 'replacement' } } }
          }
        }
      }
    })
    expect(parseProjectDesignSystem(serializeProjectDesignSystem(document))).toMatchObject({
      ok: false,
      errors: [expect.stringContaining('invalid component tree')]
    })
  })
})
