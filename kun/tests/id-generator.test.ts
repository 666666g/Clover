import { describe, expect, it } from 'vitest'
import { RandomIdGenerator } from '../src/ports/id-generator.js'

describe('RandomIdGenerator', () => {
  it('uses a cryptographically strong UUID suffix by default', () => {
    const generator = new RandomIdGenerator()
    const ids = new Set(Array.from({ length: 100 }, () => generator.next('thr')))
    expect(ids).toHaveLength(100)
    expect([...ids][0]).toMatch(/^thr_[a-f0-9]{32}$/)
  })

  it('keeps the injected random seam deterministic for tests', () => {
    expect(new RandomIdGenerator(() => 0.5).next('turn')).toBe('turn_i')
  })
})
