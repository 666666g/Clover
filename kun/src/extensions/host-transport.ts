import type {
  Disposable,
  HostNotification,
  HostRequestContext,
  HostRequestHandler,
  HostRequestOptions,
  HostTransport
} from '@kun/extension-api'
import { extensionError } from './errors.js'
import type { JsonRpcPeer } from './host-protocol.js'
import type { JsonValue } from './types.js'

export class RpcHostTransport implements HostTransport {
  private readonly notificationListeners = new Set<(notification: HostNotification) => void>()
  private readonly handlers = new Map<string, HostRequestHandler>()
  private disposed = false

  constructor(private readonly peer: JsonRpcPeer) {}

  request(method: string, params: JsonValue = null, options?: HostRequestOptions): Promise<unknown> {
    this.assertActive()
    return this.peer.request(method, params, options)
  }

  notify(method: string, params: JsonValue = null): Promise<void> {
    this.assertActive()
    return this.peer.notify(method, params)
  }

  sendStream(requestId: string, payload: JsonValue, terminal = false): Promise<void> {
    this.assertActive()
    return this.peer.sendStream(requestId, payload, terminal)
  }

  onNotification(listener: (notification: HostNotification) => void): Disposable {
    this.assertActive()
    this.notificationListeners.add(listener)
    let active = true
    return {
      dispose: () => {
        if (!active) return
        active = false
        this.notificationListeners.delete(listener)
      }
    }
  }

  registerHandler(method: string, handler: HostRequestHandler): Disposable {
    this.assertActive()
    if (this.handlers.has(method)) {
      throw extensionError('EXTENSION_HANDLER_DUPLICATE', 'Extension host handler is already registered', {
        method
      })
    }
    this.handlers.set(method, handler)
    let active = true
    return {
      dispose: () => {
        if (!active) return
        active = false
        if (this.handlers.get(method) === handler) this.handlers.delete(method)
      }
    }
  }

  async invoke(
    method: string,
    params: JsonValue,
    context: HostRequestContext
  ): Promise<JsonValue | undefined> {
    this.assertActive()
    const handler = this.handlers.get(method)
    if (handler === undefined) return undefined
    return handler(params, context)
  }

  dispatchNotification(method: string, params: JsonValue): void {
    if (this.disposed) return
    const notification: HostNotification = { method, params }
    for (const listener of [...this.notificationListeners]) listener(notification)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.notificationListeners.clear()
    this.handlers.clear()
  }

  private assertActive(): void {
    if (this.disposed) {
      throw extensionError('EXTENSION_HOST_TRANSPORT_DISPOSED', 'Extension Host transport is disposed')
    }
  }
}
