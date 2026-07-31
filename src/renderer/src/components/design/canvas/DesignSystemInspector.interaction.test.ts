import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseProjectDesignMd } from '../../../design/design-md/design-md-adapter'
import { useProjectDesignSystemStore } from '../../../design/canvas/project-design-system-store'
import { DesignSystemInspector } from './DesignSystemInspector'

const VALID = `---\nname: Inspector Theme\ncolors:\n  primary: '#336699'\ntypography:\n  body:\n    fontFamily: Inter\n    fontSize: 16px\nrounded:\n  md: 8px\nspacing:\n  md: 16px\n---\n# Colors\n`

describe('DesignSystemInspector interactions', () => {
  let renderer: ReactTestRenderer

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', { confirm: vi.fn(() => true), kunGui: {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
    const document = parseProjectDesignMd(VALID).document!
    useProjectDesignSystemStore.getState().activateWorkspace('/workspace')
    useProjectDesignSystemStore.getState().setReady(document)
    useProjectDesignSystemStore.getState().setInspectorOpen(true)
    await act(async () => { renderer = create(createElement(DesignSystemInspector, { workspaceRoot: '/workspace' })) })
  })

  it('exposes accessible tabs and a bounded narrow-window layout', () => {
    const aside = renderer.root.findByProps({ 'aria-label': 'DESIGN.md inspector' })
    expect(aside.props.className).toContain('w-[min(440px,calc(100%-32px))]')
    const tabs = renderer.root.findAllByProps({ role: 'tab' })
    expect(tabs.map((tab) => [tab.children.join(''), tab.props['aria-selected']])).toEqual([
      ['Theme', true],
      ['DESIGN.md', false]
    ])
  })

  it('preserves an invalid raw draft across tab switches and disables save shortcuts', async () => {
    const rawTab = renderer.root.findAllByProps({ role: 'tab' }).find((tab) => tab.children.join('') === 'DESIGN.md')!
    await act(async () => { rawTab.props.onClick() })
    const textarea = renderer.root.findByProps({ 'aria-label': 'Raw DESIGN.md source' })
    const invalid = '---\nname: Broken\ncolors: [\n---'
    await act(async () => { textarea.props.onChange({ target: { value: invalid } }) })
    expect(useProjectDesignSystemStore.getState().draft?.content).toBe(invalid)
    const save = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Save')!
    expect(save.props.disabled).toBe(true)
    const preventDefault = vi.fn()
    textarea.props.onKeyDown({ metaKey: true, ctrlKey: false, key: 's', preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    const themeTab = renderer.root.findAllByProps({ role: 'tab' }).find((tab) => tab.children.join('') === 'Theme')!
    await act(async () => { themeTab.props.onClick() })
    await act(async () => { renderer.root.findAllByProps({ role: 'tab' }).find((tab) => tab.children.join('') === 'DESIGN.md')!.props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': 'Raw DESIGN.md source' }).props.value).toBe(invalid)
  })

  it('shows explicit conflict recovery actions after an external watcher revision', async () => {
    await act(async () => {
      useProjectDesignSystemStore.getState().setConflict({
        baseHash: 'base',
        currentHash: 'current',
        draftContent: VALID.replace('#336699', '#abcdef'),
        currentContent: VALID.replace('#336699', '#112233')
      })
    })
    const labels = renderer.root.findAllByType('button').map((button) => button.children.join(''))
    expect(labels).toContain('Reload external')
    expect(labels).toContain('Save my draft')
  })
})
