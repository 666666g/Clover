import { describe, expect, it } from 'vitest'
import { cursorSpotlightTargets } from './cursor-spotlight'

describe('cursor spotlight tracking', () => {
  it('collects every nested spotlight target', () => {
    const parent = target(null, true)
    const plainWrapper = target(parent, false)
    const child = target(plainWrapper, true)

    expect(cursorSpotlightTargets(child)).toEqual([child, parent])
  })
})

function target(parentElement: HTMLElement | null, marked: boolean): HTMLElement {
  return {
    parentElement,
    hasAttribute: () => marked
  } as unknown as HTMLElement
}
