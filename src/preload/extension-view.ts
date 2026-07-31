import { contextBridge, ipcRenderer } from 'electron'

const SESSION_ARGUMENT = '--kun-extension-view-session='
const NONCE_ARGUMENT = '--kun-extension-view-nonce='
const sessionId =
  process.argv.find((argument) => argument.startsWith(SESSION_ARGUMENT))?.slice(SESSION_ARGUMENT.length) ?? ''
const sessionNonce =
  process.argv.find((argument) => argument.startsWith(NONCE_ARGUMENT))?.slice(NONCE_ARGUMENT.length) ?? ''

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type Handler = (
  params: JsonValue | undefined,
  context: { signal?: AbortSignal }
) => JsonValue | Promise<JsonValue>

let requestSequence = 0
let disposed = false
const notificationListeners = new Set<(notification: { method: string; params?: JsonValue }) => void>()
const handlers = new Map<string, Handler>()

function nextRequestId(): string {
  requestSequence += 1
  return `view-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function assertActiveSession(): void {
  if (disposed) throw new Error('Extension view bridge is disposed.')
  if (!sessionId || !sessionNonce) throw new Error('Extension view session is not bound.')
}

const onNotification = (
  _event: Electron.IpcRendererEvent,
  payload: { sessionId?: string; method?: unknown; params?: unknown }
): void => {
  if (payload?.sessionId !== sessionId || typeof payload.method !== 'string') return
  const notification = { method: payload.method, params: payload.params as JsonValue | undefined }
  for (const listener of [...notificationListeners]) listener(notification)
}

const onInvokeHandler = (
  _event: Electron.IpcRendererEvent,
  payload: { sessionId?: string; invocationId?: unknown; method?: unknown; params?: unknown }
): void => {
  if (
    payload?.sessionId !== sessionId ||
    typeof payload.invocationId !== 'string' ||
    typeof payload.method !== 'string'
  ) return
  const handler = handlers.get(payload.method)
  if (!handler) {
    ipcRenderer.send('extension:view:handler-result', {
      sessionId,
      sessionNonce,
      invocationId: payload.invocationId,
      ok: false,
      error: { code: 'METHOD_NOT_FOUND', message: 'View handler is not registered.' }
    })
    return
  }
  void Promise.resolve(handler(payload.params as JsonValue | undefined, {})).then(
    (result) => {
      ipcRenderer.send('extension:view:handler-result', {
        sessionId,
        sessionNonce,
        invocationId: payload.invocationId,
        ok: true,
        result
      })
    },
    (error) => {
      ipcRenderer.send('extension:view:handler-result', {
        sessionId,
        sessionNonce,
        invocationId: payload.invocationId,
        ok: false,
        error: {
          code: 'HANDLER_FAILED',
          message: error instanceof Error ? error.message.slice(0, 2_000) : 'View handler failed.'
        }
      })
    }
  )
}

ipcRenderer.on('extension:view:notification', onNotification)
ipcRenderer.on('extension:view:invoke-handler', onInvokeHandler)

const transport = {
  async request(
    method: string,
    params?: JsonValue,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<unknown> {
    assertActiveSession()
    if (options?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const requestId = nextRequestId()
    const cancel = (): void => {
      void ipcRenderer.invoke('extension:view:cancel', { sessionId, sessionNonce, requestId })
    }
    options?.signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await ipcRenderer.invoke('extension:view:request', {
        sessionId,
        sessionNonce,
        requestId,
        method,
        params,
        timeoutMs: options?.timeoutMs
      })
    } finally {
      options?.signal?.removeEventListener('abort', cancel)
    }
  },
  async notify(method: string, params?: JsonValue): Promise<void> {
    assertActiveSession()
    await ipcRenderer.invoke('extension:view:notify', {
      sessionId,
      sessionNonce,
      method,
      params
    })
  },
  onNotification(listener: (notification: { method: string; params?: JsonValue }) => void) {
    assertActiveSession()
    notificationListeners.add(listener)
    return { dispose: () => notificationListeners.delete(listener) }
  },
  registerHandler(method: string, handler: Handler) {
    assertActiveSession()
    if (handlers.has(method)) throw new Error(`View handler is already registered: ${method}`)
    handlers.set(method, handler)
    return {
      dispose: () => {
        if (handlers.get(method) === handler) handlers.delete(method)
      }
    }
  },
  dispose(): void {
    if (disposed) return
    disposed = true
    handlers.clear()
    notificationListeners.clear()
    ipcRenderer.removeListener('extension:view:notification', onNotification)
    ipcRenderer.removeListener('extension:view:invoke-handler', onInvokeHandler)
    ipcRenderer.send('extension:view:dispose', { sessionId, sessionNonce })
  }
}

contextBridge.exposeInMainWorld('kunExtension', transport)
