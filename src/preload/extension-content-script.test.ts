import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostContentScriptBootstrapBinding } from '../shared/extension-ipc'
import {
  contentScriptIsolationPrelude,
  registerExtensionContentScriptPreload
} from './extension-content-script'
import { EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE } from '../shared/extension-content-script-sources'

function binding(runAt: 'documentStart' | 'documentEnd'): ExtensionHostContentScriptBootstrapBinding {
  return {
    bindingId: 'content_script_12345678-1234-1234-1234-123456789abc',
    nonce: 'n'.repeat(43),
    worldId: 18_001,
    context: {
      apiVersion: 1,
      extensionId: 'acme.dom',
      extensionVersion: '1.2.3',
      contributionId: 'decorate',
      surface: 'workbench:code',
      runAt,
      workspaceScope: `workspace:${'a'.repeat(64)}`,
      marker: 'acme.dom/decorate',
      rawDomCompatibility: 'unsupported'
    },
    scripts: [{
      code: 'globalThis.__ran = true',
      url: 'kun-extension://acme.dom/dist/content.js'
    }],
    styles: [{
      css: '.badge { color: red }',
      url: 'kun-extension://acme.dom/dist/content.css'
    }]
  }
}

function fixture(runAt: 'documentStart' | 'documentEnd', readyState: DocumentReadyState) {
  let documentEnd: (() => void) | undefined
  const exposed: Array<{ worldId: number; apiKey: string; api: Record<string, unknown> }> = []
  const execute = vi.fn(async (
    _worldId: number,
    _scripts: Array<{ code: string; url?: string }>
  ) => undefined)
  const invoke = vi.fn(async (_channel: string, _payload: unknown) => ({ ok: true }))
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>()
  const value = binding(runAt)
  const dispose = registerExtensionContentScriptPreload({
    contextBridge: {
      exposeInIsolatedWorld: (worldId, apiKey, api) => exposed.push({
        worldId,
        apiKey,
        api: api as Record<string, unknown>
      })
    },
    ipcRenderer: {
      sendSync: () => ({ version: 1, generation: 'generation-1', bindings: [value] }),
      invoke,
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel) => listeners.delete(channel)
    },
    webFrame: { executeJavaScriptInIsolatedWorld: execute },
    lifecycle: {
      readyState: () => readyState,
      onDocumentEnd: (listener) => {
        documentEnd = listener
        return () => { documentEnd = undefined }
      }
    }
  })
  return { value, exposed, execute, invoke, listeners, dispose, fireDocumentEnd: () => documentEnd?.() }
}

describe('Direct DOM workbench preload', () => {
  it('executes documentStart immediately in its assigned isolated world', () => {
    const state = fixture('documentStart', 'loading')
    expect(state.exposed).toHaveLength(1)
    expect(state.exposed[0]).toMatchObject({ worldId: 18_001, apiKey: 'kunHost' })
    expect(Object.keys(state.exposed[0]!.api).sort()).toEqual([
      'dispose',
      'getContext',
      'reportDiagnostic'
    ])
    expect(state.execute).toHaveBeenCalledTimes(1)
    const sources = state.execute.mock.calls[0]![1]
    expect(sources[0]!.code).toContain("['kunGui', 'require', 'module'")
    expect(sources[0]!.code).toContain("['fetch', deniedFetch]")
    expect(sources.at(-1)!.url).toBe('kun-extension://acme.dom/dist/content.js')
  })

  it('does not execute documentEnd before DOMContentLoaded', () => {
    const state = fixture('documentEnd', 'loading')
    expect(state.execute).not.toHaveBeenCalled()
    state.fireDocumentEnd()
    expect(state.execute).toHaveBeenCalledTimes(1)
  })

  it('sends only binding credentials and bounded diagnostics to Main', async () => {
    const state = fixture('documentEnd', 'complete')
    const api = state.exposed[0]!.api
    expect((api.getContext as () => unknown)()).toMatchObject({
      extensionId: 'acme.dom',
      workspaceScope: `workspace:${'a'.repeat(64)}`
    })
    await (api.reportDiagnostic as (input: unknown) => Promise<void>)({
      code: 'SELECTOR_MISSING',
      message: 'The unsupported selector was absent.'
    })
    expect(state.invoke).toHaveBeenCalledWith('extension:content-script:bridge', {
      bindingId: state.value.bindingId,
      nonce: state.value.nonce,
      method: 'reportDiagnostic',
      diagnostic: {
        code: 'SELECTOR_MISSING',
        message: 'The unsupported selector was absent.',
        level: 'warning'
      }
    })
    expect(state.invoke.mock.calls[0]![1]).not.toHaveProperty('extensionId')
  })

  it('declares an equivalent no-network/no-popup policy for isolated worlds', () => {
    const prelude = contentScriptIsolationPrelude()
    expect(prelude).toContain('Direct network access is disabled')
    expect(prelude).toContain("['WebSocket', denied]")
    expect(prelude).toContain("['open', denied]")
    expect(prelude).toContain("Object.defineProperty(globalThis, key, { value: undefined")
  })

  it('uses a static deactivation source backed by the isolated-world context', () => {
    const state = fixture('documentStart', 'complete')
    const api = state.exposed[0]!.api
    ;(api.dispose as () => void)()
    const source = state.execute.mock.calls.at(-1)![1][0]!.code
    expect(source).toBe(EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE)
    expect(source).toContain('globalThis.kunHost')
    expect(source).not.toContain(JSON.stringify(state.value.context.extensionId))
  })
})
