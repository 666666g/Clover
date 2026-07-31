import type {
  ExtensionHostContentScriptBootstrap,
  ExtensionHostContentScriptBootstrapBinding,
  ExtensionHostContentScriptBridgeRequest
} from '../shared/extension-ipc'
import { EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE } from '../shared/extension-content-script-sources'

const BOOTSTRAP_CHANNEL = 'extension:content-script:bootstrap'
const INSTALL_CHANNEL = 'extension:content-script:install'
const BRIDGE_CHANNEL = 'extension:content-script:bridge'
const MAX_BINDINGS = 32
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024

type ContextBridgeLike = {
  exposeInIsolatedWorld(worldId: number, apiKey: string, api: unknown): void
}

type IpcRendererLike = {
  sendSync(channel: string): unknown
  invoke(channel: string, payload: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
}

type WebFrameLike = {
  executeJavaScriptInIsolatedWorld(
    worldId: number,
    scripts: Array<{ code: string; url?: string }>
  ): Promise<unknown>
}

type DocumentLifecycle = {
  readyState(): DocumentReadyState
  onDocumentEnd(listener: () => void): () => void
}

export type ExtensionContentScriptPreloadDependencies = {
  contextBridge: ContextBridgeLike
  ipcRenderer: IpcRendererLike
  webFrame: WebFrameLike
  lifecycle?: DocumentLifecycle
}

/**
 * Installs the only API visible in Direct DOM worlds. This module deliberately
 * imports no Node built-ins and never forwards the full `kunGui` bridge.
 */
export function registerExtensionContentScriptPreload(
  dependencies: ExtensionContentScriptPreloadDependencies
): () => void {
  const lifecycle = dependencies.lifecycle ?? browserDocumentLifecycle()
  const installed = new Map<string, { binding: ExtensionHostContentScriptBootstrapBinding; disposed: boolean }>()
  const occupiedWorlds = new Map<number, string>()
  const documentEndQueue: Array<() => void> = []
  let listeningForDocumentEnd = false

  const report = async (
    binding: ExtensionHostContentScriptBootstrapBinding,
    code: string,
    message: string,
    level: 'info' | 'warning' | 'error' = 'error'
  ): Promise<void> => {
    try {
      await dependencies.ipcRenderer.invoke(BRIDGE_CHANNEL, {
        bindingId: binding.bindingId,
        nonce: binding.nonce,
        method: 'reportDiagnostic',
        diagnostic: { code, message: message.slice(0, 2_000), level }
      } satisfies ExtensionHostContentScriptBridgeRequest)
    } catch {
      // A stale/revoked bridge is expected during navigation and teardown.
    }
  }

  const executeBinding = (record: {
    binding: ExtensionHostContentScriptBootstrapBinding
    disposed: boolean
  }): void => {
    if (record.disposed) return
    const binding = record.binding
    const sources = contentScriptSources(binding)
    void dependencies.webFrame
      .executeJavaScriptInIsolatedWorld(binding.worldId, sources)
      .catch((error) => report(
        binding,
        'CONTENT_SCRIPT_EXECUTION_FAILED',
        error instanceof Error ? error.message : 'Content-script execution failed.'
      ))
  }

  const queueForDocumentEnd = (callback: () => void): void => {
    if (lifecycle.readyState() !== 'loading') {
      callback()
      return
    }
    documentEndQueue.push(callback)
    if (listeningForDocumentEnd) return
    listeningForDocumentEnd = true
    lifecycle.onDocumentEnd(() => {
      listeningForDocumentEnd = false
      for (const queued of documentEndQueue.splice(0)) queued()
    })
  }

  const installPlan = (value: unknown): void => {
    const plan = parseBootstrap(value)
    if (!plan) return
    for (const binding of plan.bindings) {
      if (installed.has(binding.bindingId)) continue
      const occupied = occupiedWorlds.get(binding.worldId)
      if (occupied && occupied !== binding.bindingId) {
        void report(
          binding,
          'CONTENT_SCRIPT_WORLD_COLLISION',
          'The assigned isolated world is already occupied.'
        )
        continue
      }
      const record = { binding, disposed: false }
      const api = Object.freeze({
        getContext: () => Object.freeze({ ...binding.context }),
        reportDiagnostic: async (input: unknown): Promise<void> => {
          if (record.disposed) throw new Error('Content-script bridge is disposed.')
          const diagnostic = parseScriptDiagnostic(input)
          if (!diagnostic) throw new Error('Content-script diagnostic is invalid.')
          await report(binding, diagnostic.code, diagnostic.message, diagnostic.level)
        },
        dispose: (): void => {
          if (record.disposed) return
          record.disposed = true
          void dependencies.webFrame.executeJavaScriptInIsolatedWorld(
            binding.worldId,
            [deactivationSource(binding)]
          ).catch(() => undefined)
        }
      })
      try {
        dependencies.contextBridge.exposeInIsolatedWorld(binding.worldId, 'kunHost', api)
      } catch (error) {
        void report(
          binding,
          'CONTENT_SCRIPT_BRIDGE_EXPOSURE_FAILED',
          error instanceof Error ? error.message : 'Failed to expose the content-script bridge.'
        )
        continue
      }
      occupiedWorlds.set(binding.worldId, binding.bindingId)
      installed.set(binding.bindingId, record)
      if (binding.context.runAt === 'documentStart') executeBinding(record)
      else queueForDocumentEnd(() => executeBinding(record))
    }
  }

  // Synchronous by design: preload execution is the only point at which a
  // cached documentStart plan can be armed before the renderer page scripts.
  installPlan(dependencies.ipcRenderer.sendSync(BOOTSTRAP_CHANNEL))
  const onInstall = (_event: unknown, payload: unknown): void => installPlan(payload)
  dependencies.ipcRenderer.on(INSTALL_CHANNEL, onInstall)
  return () => {
    dependencies.ipcRenderer.removeListener(INSTALL_CHANNEL, onInstall)
    for (const record of installed.values()) {
      if (!record.disposed) {
        record.disposed = true
        void dependencies.webFrame.executeJavaScriptInIsolatedWorld(
          record.binding.worldId,
          [deactivationSource(record.binding)]
        ).catch(() => undefined)
      }
    }
    installed.clear()
    occupiedWorlds.clear()
    documentEndQueue.splice(0)
  }
}

export function contentScriptIsolationPrelude(): string {
  return `(() => {
    'use strict';
    const hidden = ['kunGui', 'require', 'module', 'exports', 'process', '__dirname', '__filename'];
    for (const key of hidden) {
      try { Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false }); } catch {}
    }
    const denied = () => { throw new DOMException('Direct network and popup access is disabled for Kun host content scripts.', 'SecurityError'); };
    const deniedFetch = () => Promise.reject(new DOMException('Direct network access is disabled for Kun host content scripts.', 'SecurityError'));
    for (const [key, value] of [['fetch', deniedFetch], ['WebSocket', denied], ['EventSource', denied], ['XMLHttpRequest', denied], ['Worker', denied], ['SharedWorker', denied], ['open', denied]]) {
      try { Object.defineProperty(globalThis, key, { value, writable: false, configurable: false }); } catch {}
    }
    try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, writable: false, configurable: false }); } catch {}
  })();`
}

function contentScriptSources(
  binding: ExtensionHostContentScriptBootstrapBinding
): Array<{ code: string; url?: string }> {
  return [
    {
      code: contentScriptIsolationPrelude(),
      url: `kun-extension://${binding.context.extensionId}/__kun_isolation__.js`
    },
    ...binding.styles.map((style) => ({
      code: styleInstallationCode(binding.context.marker, style.css),
      url: style.url
    })),
    ...binding.scripts.map((script) => ({ code: script.code, url: script.url }))
  ]
}

function styleInstallationCode(marker: string, css: string): string {
  return `(() => {
    const marker = ${JSON.stringify(marker)};
    const install = () => {
      const parent = document.head || document.documentElement;
      if (!parent) return false;
      document.querySelectorAll('style[data-kun-extension-style]').forEach((node) => {
        if (node.getAttribute('data-kun-extension-style') === marker) node.remove();
      });
      const style = document.createElement('style');
      style.setAttribute('data-kun-extension-style', marker);
      style.textContent = ${JSON.stringify(css)};
      parent.appendChild(style);
      return true;
    };
    if (!install()) {
      const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
      observer.observe(document, { childList: true, subtree: true });
    }
  })();`
}

function deactivationSource(
  binding: ExtensionHostContentScriptBootstrapBinding
): { code: string; url?: string } {
  return {
    code: EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE,
    url: `kun-extension://${binding.context.extensionId}/__kun_deactivate__.js`
  }
}

function parseBootstrap(value: unknown): ExtensionHostContentScriptBootstrap | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.generation !== 'string') return undefined
  if (!Array.isArray(value.bindings) || value.bindings.length > MAX_BINDINGS) return undefined
  const bindings: ExtensionHostContentScriptBootstrapBinding[] = []
  let totalBytes = 0
  for (const candidate of value.bindings) {
    if (!isBootstrapBinding(candidate)) return undefined
    for (const source of [...candidate.scripts, ...candidate.styles.map((style) => ({ code: style.css }))]) {
      const bytes = new TextEncoder().encode(source.code).byteLength
      if (bytes > MAX_FILE_BYTES) return undefined
      totalBytes += bytes
      if (totalBytes > MAX_TOTAL_BYTES) return undefined
    }
    bindings.push(candidate)
  }
  return { version: 1, generation: value.generation.slice(0, 128), bindings }
}

function isBootstrapBinding(value: unknown): value is ExtensionHostContentScriptBootstrapBinding {
  if (!isRecord(value) || !isRecord(value.context)) return false
  const context = value.context
  if (
    typeof value.bindingId !== 'string' || !/^content_script_[0-9a-f-]{36}$/i.test(value.bindingId) ||
    typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
    typeof value.worldId !== 'number' || !Number.isInteger(value.worldId) ||
    value.worldId < 10_000 || value.worldId > 2_147_483_647 ||
    context.apiVersion !== 1 ||
    typeof context.extensionId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/.test(context.extensionId) ||
    typeof context.extensionVersion !== 'string' || context.extensionVersion.length > 128 ||
    typeof context.contributionId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(context.contributionId) ||
    !['workbench:code', 'workbench:design', 'workbench:write', 'workbench:connect'].includes(String(context.surface)) ||
    !['documentStart', 'documentEnd'].includes(String(context.runAt)) ||
    typeof context.workspaceScope !== 'string' || context.workspaceScope.length > 128 ||
    typeof context.marker !== 'string' || context.marker !== `${context.extensionId}/${context.contributionId}` ||
    context.rawDomCompatibility !== 'unsupported' ||
    !Array.isArray(value.scripts) || value.scripts.length < 1 || value.scripts.length > 32 ||
    !Array.isArray(value.styles) || value.styles.length > 32
  ) return false
  const prefix = `kun-extension://${context.extensionId}/`
  return value.scripts.every((source) => isRecord(source) &&
    typeof source.code === 'string' && typeof source.url === 'string' && source.url.startsWith(prefix)) &&
    value.styles.every((style) => isRecord(style) &&
      typeof style.css === 'string' && typeof style.url === 'string' && style.url.startsWith(prefix))
}

function parseScriptDiagnostic(value: unknown): {
  code: string
  message: string
  level: 'info' | 'warning' | 'error'
} | undefined {
  if (!isRecord(value)) return undefined
  const level = value.level ?? 'warning'
  if (
    typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.code) ||
    typeof value.message !== 'string' || value.message.trim().length < 1 || value.message.length > 2_000 ||
    !['info', 'warning', 'error'].includes(String(level))
  ) return undefined
  return {
    code: value.code,
    message: value.message.trim(),
    level: level as 'info' | 'warning' | 'error'
  }
}

function browserDocumentLifecycle(): DocumentLifecycle {
  return {
    readyState: () => document.readyState,
    onDocumentEnd: (listener) => {
      window.addEventListener('DOMContentLoaded', listener, { once: true })
      return () => window.removeEventListener('DOMContentLoaded', listener)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
