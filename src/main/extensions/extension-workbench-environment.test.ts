import { describe, expect, it } from 'vitest'
import { createExtensionWorkbenchEnvironment } from './extension-workbench-environment'

describe('extension workbench environment', () => {
  it('projects the resolved host theme, locale, zoom and accessibility settings', () => {
    const environment = createExtensionWorkbenchEnvironment({
      themePreference: 'system',
      systemDark: true,
      highContrast: false,
      zoomFactor: 1.25,
      reducedMotion: true,
      locale: 'zh'
    })

    expect(environment).toMatchObject({
      theme: {
        kind: 'dark',
        zoomFactor: 1.25,
        reducedMotion: true,
        tokens: { background: '#121827', foreground: '#f0f5fc' }
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    })
  })

  it('honors explicit light mode and exposes high contrast independently', () => {
    expect(createExtensionWorkbenchEnvironment({
      themePreference: 'light',
      systemDark: true,
      highContrast: false,
      zoomFactor: 0,
      reducedMotion: false,
      locale: 'en'
    }).theme).toMatchObject({ kind: 'light', zoomFactor: 1 })

    expect(createExtensionWorkbenchEnvironment({
      themePreference: 'system',
      systemDark: false,
      highContrast: true,
      zoomFactor: 1,
      reducedMotion: false,
      locale: 'ar'
    })).toMatchObject({
      theme: { kind: 'high-contrast', tokens: { border: '#000000' } },
      locale: { direction: 'rtl' }
    })
  })
})
