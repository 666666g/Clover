import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeferredRender } from './use-deferred-render'

function Probe({ onValue }: { onValue: (value: boolean) => void }) {
  const { ref, shouldRender } = useDeferredRender<HTMLDivElement>({
    enabled: true,
    rootMargin: '480px',
    debounceMs: 0,
    idleTimeoutMs: 0
  })
  useEffect(() => {
    onValue(shouldRender)
  }, [onValue, shouldRender])
  return createElement('div', { ref })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useDeferredRender', () => {
  it('keeps offscreen content deferred until its observer admits it', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    let observerCallback: IntersectionObserverCallback | undefined
    const observer = {
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: '480px',
      thresholds: [0]
    } satisfies IntersectionObserver
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
        return observer
      }
    })
    const values: boolean[] = []
    let renderer: ReactTestRenderer | undefined

    await act(async () => {
      renderer = create(createElement(Probe, { onValue: (value) => values.push(value) }), {
        createNodeMock: () => ({})
      })
    })
    expect(values.at(-1)).toBe(false)
    expect(observer.observe).toHaveBeenCalledTimes(1)

    await act(async () => {
      observerCallback?.([
        { isIntersecting: true } as IntersectionObserverEntry
      ], observer)
      await vi.runAllTimersAsync()
    })
    expect(values.at(-1)).toBe(true)

    await act(async () => renderer?.unmount())
  })

  it('loads immediately when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('IntersectionObserver', undefined)
    const values: boolean[] = []
    let renderer: ReactTestRenderer | undefined

    await act(async () => {
      renderer = create(createElement(Probe, { onValue: (value) => values.push(value) }), {
        createNodeMock: () => ({})
      })
    })

    expect(values).toContain(false)
    expect(values.at(-1)).toBe(true)
    await act(async () => renderer?.unmount())
  })
})
