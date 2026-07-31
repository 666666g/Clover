import { describe, expect, it } from 'vitest'
import { buildWritePresentationPrompt, isPresentationMarkdownPath } from './write-presentation'

describe('write presentation helpers', () => {
  it('accepts Markdown but not MDX or arbitrary text files', () => {
    expect(isPresentationMarkdownPath('/workspace/brief.md')).toBe(true)
    expect(isPresentationMarkdownPath('/workspace/brief.markdown')).toBe(true)
    expect(isPresentationMarkdownPath('/workspace/brief.mdx')).toBe(false)
    expect(isPresentationMarkdownPath('/workspace/brief.txt')).toBe(false)
  })

  it('builds an explicit, source-preserving PPT Master prompt', () => {
    const prompt = buildWritePresentationPrompt({
      workspaceRoot: '/workspace',
      sourcePath: '/workspace/季度复盘.md'
    })

    expect(prompt).toContain('$ppt-master')
    expect(prompt).toContain('唯一来源 Markdown：/workspace/季度复盘.md')
    expect(prompt).toContain('最终文件：presentations/季度复盘.pptx')
    expect(prompt).toContain('ppt_master_confirm_design')
    expect(prompt).toContain('不要修改、重命名或移动来源 Markdown')
    expect(prompt).toContain('ppt_master_run')
  })
})
