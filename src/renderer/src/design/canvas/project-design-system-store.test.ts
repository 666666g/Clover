import { beforeEach, describe, expect, it } from 'vitest'
import { parseProjectDesignMd } from '../design-md/design-md-adapter'
import { useProjectDesignSystemStore } from './project-design-system-store'

const source = (color: string) => `---\nname: Lifecycle\ncolors:\n  primary: '${color}'\n---\n# Colors\n`

describe('project DESIGN.md lifecycle store', () => {
  beforeEach(() => useProjectDesignSystemStore.getState().activateWorkspace('/one'))

  it('moves through initial ready, invalid-last-valid, deletion, and recreation states', () => {
    const first = parseProjectDesignMd(source('#112233')).document!
    useProjectDesignSystemStore.getState().setReady(first)
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ status: 'ready', document: first })
    useProjectDesignSystemStore.getState().setInvalid([{ severity: 'error', message: 'bad revision', source: 'kun' }])
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ status: 'invalid', document: first })
    useProjectDesignSystemStore.getState().setMissing()
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ status: 'missing', document: null, inspectorOpen: false })
    const recreated = parseProjectDesignMd(source('#445566')).document!
    useProjectDesignSystemStore.getState().setReady(recreated)
    expect(useProjectDesignSystemStore.getState()).toMatchObject({ status: 'ready', document: recreated })
  })

  it('fences stale workspace state and closes the inspector on switches', () => {
    useProjectDesignSystemStore.getState().setReady(parseProjectDesignMd(source('#112233')).document!)
    useProjectDesignSystemStore.getState().setInspectorOpen(true)
    useProjectDesignSystemStore.getState().activateWorkspace('/two')
    expect(useProjectDesignSystemStore.getState()).toMatchObject({
      workspaceRoot: '/two',
      status: 'loading',
      document: null,
      inspectorOpen: false
    })
  })
})
