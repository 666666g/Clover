import { LocaleSchema, ThemeSchema, type Locale, type Theme } from '@kun/extension-api'

export type ExtensionWorkbenchEnvironmentInput = {
  themePreference: 'system' | 'light' | 'dark'
  systemDark: boolean
  highContrast: boolean
  zoomFactor: number
  reducedMotion: boolean
  locale: string
}

export type ExtensionWorkbenchEnvironmentSnapshot = {
  theme: Theme
  locale: Locale
}

const LIGHT_TOKENS = {
  background: '#fafbff',
  sidebarBackground: '#eef2fa',
  surface: '#ffffff',
  foreground: '#233659',
  mutedForeground: '#54678c',
  border: 'rgba(20, 47, 95, 0.13)',
  accent: '#3b82d8',
  focusRing: '#3b82d8',
  success: '#128a4a',
  danger: '#d6493f'
} as const

const DARK_TOKENS = {
  background: '#121827',
  sidebarBackground: '#181f32',
  surface: '#1b2338',
  foreground: '#f0f5fc',
  mutedForeground: '#bdc9de',
  border: 'rgba(151, 192, 235, 0.13)',
  accent: '#6fb0e8',
  focusRing: '#8bc5f5',
  success: '#40c977',
  danger: '#f8736a'
} as const

const HIGH_CONTRAST_LIGHT_TOKENS = {
  ...LIGHT_TOKENS,
  background: '#ffffff',
  sidebarBackground: '#ffffff',
  surface: '#ffffff',
  foreground: '#000000',
  mutedForeground: '#1a1a1a',
  border: '#000000',
  accent: '#0047ab',
  focusRing: '#000000'
} as const

const HIGH_CONTRAST_DARK_TOKENS = {
  ...DARK_TOKENS,
  background: '#000000',
  sidebarBackground: '#000000',
  surface: '#000000',
  foreground: '#ffffff',
  mutedForeground: '#f2f2f2',
  border: '#ffffff',
  accent: '#7cc7ff',
  focusRing: '#ffffff'
} as const

/** Build the public, DOM-independent environment projected to extension Views. */
export function createExtensionWorkbenchEnvironment(
  input: ExtensionWorkbenchEnvironmentInput
): ExtensionWorkbenchEnvironmentSnapshot {
  const dark = input.themePreference === 'dark' ||
    (input.themePreference === 'system' && input.systemDark)
  const kind: Theme['kind'] = input.highContrast ? 'high-contrast' : dark ? 'dark' : 'light'
  const tokens = input.highContrast
    ? dark ? HIGH_CONTRAST_DARK_TOKENS : HIGH_CONTRAST_LIGHT_TOKENS
    : dark ? DARK_TOKENS : LIGHT_TOKENS
  const language = input.locale.trim() || 'en'
  return {
    theme: ThemeSchema.parse({
      kind,
      tokens,
      zoomFactor: Number.isFinite(input.zoomFactor) && input.zoomFactor > 0
        ? input.zoomFactor
        : 1,
      reducedMotion: input.reducedMotion
    }),
    locale: LocaleSchema.parse({
      language,
      direction: /^(ar|fa|he|ur)(?:-|$)/i.test(language) ? 'rtl' : 'ltr',
      messages: {}
    })
  }
}
