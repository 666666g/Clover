import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { createEmptyDocument } from '../../design/canvas/canvas-types'
import { useDesignSystemStore } from '../../design/canvas/design-system-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignDocument } from '../../design/design-types'
import { DesignContractPanel } from './DesignContractPanel'

const now = '2026-07-02T00:00:00.000Z'

function document(): DesignDocument {
  return {
    id: 'doc',
    title: 'Checkout redesign',
    createdAt: now,
    updatedAt: now,
    order: 0,
    artifacts: [],
    activeArtifactId: null
  }
}

describe('DesignContractPanel', () => {
  beforeEach(() => {
    useCanvasShapeStore.setState({ document: createEmptyDocument(), documentKey: null })
    useDesignSystemStore.setState({ system: { tokens: {}, components: {} } })
    useDesignWorkspaceStore.setState({ designContext: { designTarget: 'web' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders DESIGN.md export and agent handoff actions', () => {
    const html = renderToStaticMarkup(
      createElement(DesignContractPanel, {
        workspaceRoot: '/workspace',
        document: document(),
        onSeedPrompt: () => {}
      })
    )

    expect(html).toContain('Design contract')
    expect(html).toContain('Project DESIGN.md')
    expect(html).toContain('Prepare handoff package')
    expect(html).toContain('design.export')
  })

  it('renders nothing without an active design document', () => {
    expect(renderToStaticMarkup(
      createElement(DesignContractPanel, {
        workspaceRoot: '/workspace',
        document: null
      })
    )).toBe('')
  })

  it('shows a resolved write failure instead of reporting export success', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', {
      kunGui: {
        writeWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'disk full' }))
      }
    })
    const activeDocument = document()
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      documents: [activeDocument],
      activeDocumentId: activeDocument.id,
      artifacts: [],
      activeArtifactId: null
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(DesignContractPanel, {
        workspaceRoot: '/workspace',
        document: activeDocument
      }))
    })

    await act(async () => {
      renderer.root.findAllByType('button')[0].props.onClick()
      await Promise.resolve()
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('disk full')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Exported to')
  })
})
