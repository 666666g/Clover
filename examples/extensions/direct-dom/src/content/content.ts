import type { KunHostContentScriptApi } from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunHost: KunHostContentScriptApi
  }
}

// Direct DOM is deliberately outside Extension API SemVer. Every selector below
// is an unsupported compatibility dependency and must fail without harming Kun.
(() => {
  const context = window.kunHost.getContext()
  const extensionRootId = 'kun-example-direct-dom-warning'

  // Kun never injects content scripts into protected windows. Keep a defensive
  // check as well so a future host regression cannot make this example render.
  if (document.documentElement.hasAttribute('data-kun-protected-surface')) return
  if (document.getElementById(extensionRootId)) return

  const target =
    document.querySelector<HTMLElement>('[data-kun-surface="workbench-topbar"]') ??
    document.querySelector<HTMLElement>('[role="banner"]')
  if (!target) {
    void window.kunHost.reportDiagnostic({
      code: 'SELECTOR_MISSING',
      message: 'The unsupported workbench top-bar selector was not found.',
      level: 'warning'
    })
    return
  }

  const badge = document.createElement('span')
  badge.id = extensionRootId
  badge.dataset.kunExtensionRoot = context.marker
  badge.setAttribute('role', 'status')
  badge.textContent = 'Direct DOM example (unsupported selector)'
  target.append(badge)

  const cleanup = (): void => {
    badge.remove()
    window.removeEventListener('kun-extension-deactivate', cleanup)
  }
  window.addEventListener('kun-extension-deactivate', cleanup, { once: true })
  window.addEventListener('pagehide', cleanup, { once: true })
})()
