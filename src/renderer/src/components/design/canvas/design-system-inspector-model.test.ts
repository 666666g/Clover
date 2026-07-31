import { describe, expect, it } from 'vitest'
import { highlightDesignMdLine } from './design-system-inspector-model'

describe('DESIGN.md syntax highlighting model', () => {
  it('classifies front matter, YAML keys and Markdown headings', () => {
    expect(highlightDesignMdLine('---')).toEqual([{ text: '---', kind: 'fence' }])
    expect(highlightDesignMdLine("  primary: '#fff'")).toEqual([
      { text: '  primary:', kind: 'key' },
      { text: " '#fff'", kind: 'value' }
    ])
    expect(highlightDesignMdLine('## Colors')).toEqual([{ text: '## Colors', kind: 'heading' }])
  })
})
