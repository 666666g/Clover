import { describe, expect, it } from 'vitest'
import {
  clearProtectedSurfaceRestore,
  markProtectedSurfaceRestore,
  readProtectedSurfaceRestore
} from './protected-surface-session'

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

describe('protected renderer surface reload state', () => {
  it('restores only known protected targets and clears the matching target', () => {
    const storage = memoryStorage()
    expect(readProtectedSurfaceRestore(storage)).toBeUndefined()
    markProtectedSurfaceRestore('settings', storage)
    expect(readProtectedSurfaceRestore(storage)).toBe('settings')
    clearProtectedSurfaceRestore('initial-setup', storage)
    expect(readProtectedSurfaceRestore(storage)).toBe('settings')
    clearProtectedSurfaceRestore('settings', storage)
    expect(readProtectedSurfaceRestore(storage)).toBeUndefined()
  })
})
