import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  const csp = (() => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    return html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
  })()

  it('allows blob image URLs for local attachment previews', () => {
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''
    expect(imgSrc.split(/\s+/)).toContain('blob:')
  })

  it('allows data and blob URLs for workspace video previews', () => {
    const mediaSrc = csp.match(/media-src\s+([^;]+)/)?.[1] ?? ''
    const parts = mediaSrc.split(/\s+/)
    expect(parts).toContain('data:')
    expect(parts).toContain('blob:')
  })
})
