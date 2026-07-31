import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES,
  readWriteEditorDisplayPreferences,
  writeWriteEditorDisplayPreferences
} from './write-editor-display-preferences'

function memoryStorage(initial?: string): BrowserStorageLike & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value
    },
    setItem(_key, value) {
      this.value = value
    }
  }
}

describe('Write editor display preferences', () => {
  it('keeps wrapping enabled and line numbers hidden by default', () => {
    expect(readWriteEditorDisplayPreferences(memoryStorage())).toEqual(
      DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES
    )
  })

  it('round-trips line-number and wrapping choices', () => {
    const storage = memoryStorage()

    writeWriteEditorDisplayPreferences({ lineNumbers: true, lineWrapping: false }, storage)

    expect(readWriteEditorDisplayPreferences(storage)).toEqual({
      lineNumbers: true,
      lineWrapping: false
    })
  })

  it('recovers from malformed and partial storage values', () => {
    expect(readWriteEditorDisplayPreferences(memoryStorage('{broken'))).toEqual(
      DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES
    )
    expect(readWriteEditorDisplayPreferences(memoryStorage('{"lineNumbers":true}'))).toEqual({
      lineNumbers: true,
      lineWrapping: true
    })
  })

  it('does not throw when storage rejects writes', () => {
    const storage: BrowserStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      }
    }

    expect(() => writeWriteEditorDisplayPreferences(
      DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES,
      storage
    )).not.toThrow()
  })
})
