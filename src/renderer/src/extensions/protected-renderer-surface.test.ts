import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProtectedRendererSurface } from './ProtectedRendererSurface'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProtectedRendererSurface', () => {
  it('keeps credential children unmounted while a clean Direct DOM reload is pending', async () => {
    const extensionSyncHostContentScripts = vi.fn(async () => ({
      ok: false as const,
      code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
      message: 'protected',
      reloadScheduled: true
    }))
    vi.stubGlobal('window', {
      sessionStorage: memoryStorage(),
      kunGui: { extensionSyncHostContentScripts, logError: vi.fn() }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ProtectedRendererSurface, {
        kind: 'account-credentials',
        restoreTarget: 'settings',
        fallback: createElement('span', null, 'isolating'),
        children: createElement('input', { value: 'secret-api-key', readOnly: true })
      }))
    })

    expect(extensionSyncHostContentScripts).toHaveBeenCalledWith({
      surface: null,
      protectedSurface: 'account-credentials',
      descriptors: []
    })
    expect(renderer!.root.findAllByType('input')).toHaveLength(0)
    expect(renderer!.root.findByType('span').children).toEqual(['isolating'])
  })

  it('mounts credential children only after Main reports a clean protected document', async () => {
    vi.stubGlobal('window', {
      sessionStorage: memoryStorage(),
      kunGui: {
        extensionSyncHostContentScripts: vi.fn(async () => ({
          ok: false as const,
          code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
          message: 'protected',
          reloadScheduled: false
        })),
        logError: vi.fn()
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ProtectedRendererSurface, {
        kind: 'account-credentials',
        restoreTarget: 'settings',
        fallback: createElement('span', null, 'isolating'),
        children: createElement('input', { value: 'secret-api-key', readOnly: true })
      }))
    })

    expect(renderer!.root.findAllByType('span')).toHaveLength(0)
    expect(renderer!.root.findByType('input').props.value).toBe('secret-api-key')
  })
})
