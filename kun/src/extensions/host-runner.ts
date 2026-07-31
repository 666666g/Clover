import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createExtensionContext,
  type ExtensionContext,
  type StateMigration,
  type WorkspaceContext,
  WorkspaceContextSchema
} from '@kun/extension-api'
import { z } from 'zod'
import { extensionError } from './errors.js'
import {
  DEFAULT_EXTENSION_CONCURRENT_REQUESTS,
  DEFAULT_EXTENSION_MESSAGE_BYTES,
  DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS,
  DEFAULT_EXTENSION_STREAM_BUFFER_BYTES,
  DEFAULT_EXTENSION_STREAM_WINDOW,
  JsonRpcPeer,
  type RpcEnvelope,
  type RpcRequestContext
} from './host-protocol.js'
import { RpcHostTransport } from './host-transport.js'
import { EXTENSION_RPC_VERSION, type JsonValue } from './types.js'

const InitializationSchema = z.object({
  identity: z.object({
    extensionId: z.string(),
    publisher: z.string(),
    name: z.string(),
    version: z.string(),
    declaredApiVersion: z.string(),
    apiVersion: z.string(),
    lifecycleNonce: z.string().uuid(),
    development: z.boolean()
  }).strict(),
  extensionRoot: z.string(),
  entrypoint: z.string(),
  grantedPermissions: z.array(z.string()),
  workspaceRoots: z.array(z.string()),
  capabilities: z.array(z.string()),
  workspaceContext: WorkspaceContextSchema.optional(),
  limits: z.object({
    maxMessageBytes: z.number().int().positive(),
    maxConcurrentRequests: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive(),
    streamWindow: z.number().int().positive(),
    maxStreamBufferBytes: z.number().int().positive()
  }).strict()
}).strict()

type Initialization = z.infer<typeof InitializationSchema>

export type ExtensionHostContext = ExtensionContext

type ExtensionModule = {
  activate?: (context: ExtensionContext) => unknown | Promise<unknown>
  deactivate?: () => unknown | Promise<unknown>
  migrateState?: StateMigration
  [key: string]: unknown
}

type ActivationResult = {
  handlers?: Record<string, (params: JsonValue, context: RpcRequestContext) => unknown | Promise<unknown>>
}

export async function runExtensionHost(): Promise<void> {
  if (typeof process.send !== 'function') {
    throw extensionError('EXTENSION_HOST_IPC_REQUIRED', 'Extension host runner requires a Node IPC channel')
  }

  let peer: JsonRpcPeer
  let transport: RpcHostTransport
  let initialization: Initialization | undefined
  let extensionModule: ExtensionModule | undefined
  let activationResult: ActivationResult | undefined
  let activationContext: ExtensionHostContext | undefined
  let activated = false
  let deactivated = false

  const onRequest = async (
    method: string,
    params: JsonValue,
    requestContext: RpcRequestContext
  ): Promise<JsonValue> => {
    switch (method) {
      case 'host.initialize': {
        if (initialization !== undefined) {
          throw extensionError('EXTENSION_HOST_ALREADY_INITIALIZED', 'Host is already initialized')
        }
        const parsed = InitializationSchema.safeParse(params)
        if (!parsed.success) {
          throw extensionError('EXTENSION_HOST_INITIALIZATION_INVALID', 'Host initialization is invalid', {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message
            }))
          })
        }
        initialization = parsed.data
        return {
          initialized: true,
          rpcVersion: EXTENSION_RPC_VERSION,
          apiVersion: initialization.identity.apiVersion
        }
      }
      case 'host.load': {
        const initialized = requireHandshake(initialization)
        if (extensionModule !== undefined) return { loaded: true }
        const entrypoint = await confinedEntrypoint(
          initialized.extensionRoot,
          initialized.entrypoint
        )
        extensionModule = await import(
          `${pathToFileURL(entrypoint).href}?kunHost=${encodeURIComponent(initialized.identity.lifecycleNonce)}`
        ) as ExtensionModule
        return { loaded: true }
      }
      case 'extension.activate': {
        const initialized = requireLoaded(initialization, extensionModule)
        if (activated) return { activated: true, repeated: true }
        const activate = initialized.module.activate
        if (activate !== undefined && typeof activate !== 'function') {
          throw extensionError('EXTENSION_ACTIVATE_INVALID', 'activate export must be a function')
        }
        const activation = parseActivation(params)
        activationContext = createExtensionContext(transport, {
          extension: {
            id: initialized.initialization.identity.extensionId,
            publisher: initialized.initialization.identity.publisher,
            name: initialized.initialization.identity.name,
            version: initialized.initialization.identity.version
          },
          apiVersion: initialized.initialization.identity.apiVersion,
          capabilities: initialized.initialization.capabilities,
          permissions: initialized.initialization.grantedPermissions,
          activationEvent: activation.event,
          ...(initialized.initialization.workspaceContext === undefined
            ? {}
            : { workspaceContext: initialized.initialization.workspaceContext })
        })
        const result = await activate?.(activationContext)
        activationResult = isActivationResult(result) ? result : undefined
        activated = true
        deactivated = false
        return { activated: true }
      }
      case 'extension.invoke': {
        const initialized = requireLoaded(initialization, extensionModule)
        if (!activated || deactivated) {
          throw extensionError('EXTENSION_NOT_ACTIVE', 'Extension is not active')
        }
        const invocation = parseInvocation(params)
        const transportResult = await transport.invoke(invocation.method, invocation.params, {
          signal: requestContext.signal,
          requestId: requestContext.id
        })
        if (transportResult !== undefined) return toJsonValue(transportResult)
        const handler = activationResult?.handlers?.[invocation.method] ?? initialized.module[invocation.method]
        if (typeof handler !== 'function') {
          throw extensionError('EXTENSION_HANDLER_NOT_FOUND', 'Extension handler is not registered', {
            method: invocation.method
          })
        }
        const value = await handler(invocation.params, requestContext)
        return toJsonValue(value)
      }
      case 'extension.migrateState': {
        const initialized = requireLoaded(initialization, extensionModule)
        const migration = parseMigration(params)
        if (typeof initialized.module.migrateState !== 'function') {
          throw extensionError('EXTENSION_STATE_MIGRATION_UNAVAILABLE', 'Extension has no migrateState export', {
            from: migration.from,
            to: migration.to
          })
        }
        const migrationContext = {
          extension: {
            id: initialized.initialization.identity.extensionId,
            publisher: initialized.initialization.identity.publisher,
            name: initialized.initialization.identity.name,
            version: initialized.initialization.identity.version
          },
          scope: migration.scope,
          ...(migration.workspace === undefined ? {} : { workspace: migration.workspace }),
          fromVersion: migration.from,
          toVersion: migration.to
        } as const
        return toJsonValue(
          await initialized.module.migrateState(migration.state, migrationContext)
        )
      }
      case 'extension.deactivate':
        await deactivate()
        return { deactivated: true }
      default:
        throw extensionError('EXTENSION_HOST_METHOD_UNSUPPORTED', 'Host method is not supported', {
          method
        })
    }
  }

  const deactivate = async (): Promise<void> => {
    if (deactivated) return
    deactivated = true
    if (activated) await extensionModule?.deactivate?.()
    try {
      await activationContext?.subscriptions.dispose()
    } catch (error) {
      await peer.notify('host.disposeError', {
        message: error instanceof Error ? error.message.slice(0, 1_000) : 'Dispose failed'
      }).catch(() => undefined)
    }
    transport.dispose()
    activated = false
  }

  peer = new JsonRpcPeer({
    send: sendToParent,
    onRequest,
    onNotification: (method, params) => transport.dispatchNotification(method, params),
    maxMessageBytes: DEFAULT_EXTENSION_MESSAGE_BYTES,
    maxConcurrentRequests: DEFAULT_EXTENSION_CONCURRENT_REQUESTS,
    defaultRequestTimeoutMs: DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS,
    streamWindow: DEFAULT_EXTENSION_STREAM_WINDOW,
    maxStreamBufferBytes: DEFAULT_EXTENSION_STREAM_BUFFER_BYTES
  })
  transport = new RpcHostTransport(peer)

  process.on('message', (message: unknown) => {
    void peer.receive(message).catch(async (error: unknown) => {
      await peer.notify('host.fatal', {
        code: (error as { code?: string })?.code ?? 'EXTENSION_HOST_PROTOCOL_ERROR',
        message: error instanceof Error ? error.message.slice(0, 1_000) : 'Protocol error'
      }).catch(() => undefined)
      peer.close(error)
      process.exitCode = 1
      process.disconnect?.()
    })
  })

  const metricsTimer = setInterval(() => {
    const usage = process.memoryUsage()
    void peer.notify('host.metrics', {
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      external: usage.external
    }).catch(() => undefined)
  }, 1_000)
  metricsTimer.unref()

  const shutdown = async (): Promise<void> => {
    clearInterval(metricsTimer)
    await deactivate().catch(() => undefined)
    peer.close()
    process.disconnect?.()
  }
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)))
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)))
  process.once('disconnect', () => void shutdown().finally(() => process.exit(0)))

  process.once('uncaughtException', (error) => {
    void peer.notify('host.fatal', {
      code: 'EXTENSION_UNCAUGHT_EXCEPTION',
      message: error.message.slice(0, 1_000)
    }).finally(() => process.exit(1))
  })
  process.once('unhandledRejection', (error) => {
    void peer.notify('host.fatal', {
      code: 'EXTENSION_UNHANDLED_REJECTION',
      message: error instanceof Error ? error.message.slice(0, 1_000) : 'Unhandled rejection'
    }).finally(() => process.exit(1))
  })

  await peer.notify('host.ready', { pid: process.pid })
}

async function confinedEntrypoint(extensionRoot: string, entrypoint: string): Promise<string> {
  const root = await realpath(resolve(extensionRoot))
  const target = resolve(root, entrypoint)
  if (!target.startsWith(`${root}${sep}`)) {
    throw extensionError('EXTENSION_ENTRYPOINT_INVALID', 'Extension entrypoint escapes package root', {
      entrypoint
    })
  }
  const resolvedTarget = await realpath(target)
  if (!resolvedTarget.startsWith(`${root}${sep}`)) {
    throw extensionError('EXTENSION_ENTRYPOINT_INVALID', 'Extension entrypoint resolves outside package root', {
      entrypoint
    })
  }
  const details = await lstat(resolvedTarget)
  if (!details.isFile()) {
    throw extensionError('EXTENSION_ENTRYPOINT_INVALID', 'Extension entrypoint is not a regular file', {
      entrypoint
    })
  }
  return resolvedTarget
}

function parseInvocation(params: JsonValue): { method: string; params: JsonValue } {
  if (!isRecord(params) || typeof params.method !== 'string' || params.method.length === 0) {
    throw extensionError('EXTENSION_INVOCATION_INVALID', 'Extension invocation is invalid')
  }
  return {
    method: params.method,
    params: (params.params as JsonValue | undefined) ?? null
  }
}

function parseActivation(params: JsonValue): { event: string } {
  if (!isRecord(params) || typeof params.event !== 'string' || params.event.length === 0) {
    throw extensionError('EXTENSION_ACTIVATION_INVALID', 'Extension activation request is invalid')
  }
  return { event: params.event }
}

function parseMigration(params: JsonValue): {
  from: number
  to: number
  state: JsonValue
  scope: 'global' | 'workspace'
  workspace?: WorkspaceContext
} {
  if (
    !isRecord(params) ||
    !Number.isSafeInteger(params.from) ||
    !Number.isSafeInteger(params.to) ||
    (params.from as number) < 0 ||
    (params.to as number) <= (params.from as number) ||
    !['global', 'workspace'].includes(String(params.scope))
  ) {
    throw extensionError('EXTENSION_STATE_MIGRATION_INVALID', 'State migration request is invalid')
  }
  return {
    from: params.from as number,
    to: params.to as number,
    state: (params.state as JsonValue | undefined) ?? null,
    scope: params.scope as 'global' | 'workspace',
    ...(isWorkspaceContext(params.workspace)
      ? { workspace: params.workspace as WorkspaceContext }
      : {})
  }
}

function requireHandshake(initialization: Initialization | undefined): Initialization {
  if (initialization === undefined) {
    throw extensionError('EXTENSION_HOST_NOT_INITIALIZED', 'Extension host handshake is incomplete')
  }
  return initialization
}

function requireLoaded(
  initialization: Initialization | undefined,
  module: ExtensionModule | undefined
): { initialization: Initialization; module: ExtensionModule } {
  if (initialization === undefined || module === undefined) {
    throw extensionError('EXTENSION_HOST_NOT_INITIALIZED', 'Extension host is not initialized')
  }
  return { initialization, module }
}

function isActivationResult(value: unknown): value is ActivationResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch (error) {
    throw extensionError('EXTENSION_RESULT_NOT_SERIALIZABLE', 'Extension result is not JSON serializable', {}, error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkspaceContext(value: unknown): value is WorkspaceContext {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.root === 'string' &&
    typeof value.trusted === 'boolean' &&
    typeof value.active === 'boolean'
}

function sendToParent(envelope: RpcEnvelope): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(extensionError('EXTENSION_HOST_CLOSED', 'Parent IPC channel is closed'))
      return
    }
    process.send(envelope, (error) => {
      if (error !== null) reject(error)
      else resolvePromise()
    })
  })
}

if (process.env.KUN_EXTENSION_HOST_RUNNER === '1') {
  void runExtensionHost().catch((error: unknown) => {
    process.stderr.write(
      `[kun-extension-host] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    )
    process.exit(1)
  })
}
