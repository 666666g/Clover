import { describe, expect, it } from 'vitest'
import { normalizeAppSettings } from './app-settings-normalize'
import { APP_SETTINGS_FIELD_OWNERS } from './app-settings-domain'

describe('settings domain field inventory', () => {
  it('covers every key emitted by canonical normalization', () => {
    const normalized = normalizeAppSettings({} as never)
    expect(Object.keys(APP_SETTINGS_FIELD_OWNERS).sort()).toEqual(Object.keys(normalized).sort())
  })
})
