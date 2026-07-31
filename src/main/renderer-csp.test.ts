import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  const csp = (() => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    return html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
  })()

  it('allows only the required local and extension image URL families', () => {
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''
    expect(imgSrc.split(/\s+/)).toContain('blob:')
    expect(imgSrc.split(/\s+/)).toContain('kun-extension:')
    expect(imgSrc.split(/\s+/)).not.toContain('https:')
  })

  it('allows data and blob URLs for workspace video previews', () => {
    const mediaSrc = csp.match(/media-src\s+([^;]+)/)?.[1] ?? ''
    const parts = mediaSrc.split(/\s+/)
    expect(parts).toContain('data:')
    expect(parts).toContain('blob:')
  })
})
