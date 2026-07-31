import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type ReactNode,
  type SetStateAction
} from 'react'
import type {
  Account,
  AgentRun,
  AgentRunEvent,
  ExtensionHostClient,
  HostMessage,
  JsonValue,
  Locale,
  ProviderStatus,
  Theme
} from '@kun/extension-api'

const MAX_RETAINED_AGENT_EVENTS = 512
const MAX_AGENT_SUBSCRIBE_RETRY_MS = 5_000

const ClientContext = createContext<ExtensionHostClient | undefined>(undefined)

export interface ExtensionViewProviderProps extends PropsWithChildren {
  client: ExtensionHostClient
}

export function ExtensionViewProvider({ client, children }: ExtensionViewProviderProps) {
  return createElement(ClientContext.Provider, { value: client }, children)
}

export function useExtensionClient(): ExtensionHostClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('Kun React hooks must be used inside ExtensionViewProvider')
  return client
}

export interface AsyncValue<T> {
  readonly data: T | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  readonly refresh: () => Promise<void>
}

function useAsyncValue<T>(loader: () => Promise<T>, dependencies: readonly unknown[]): AsyncValue<T> {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError(undefined)
    try {
      const value = await loader()
      if (generation.current === current) setData(value)
    } catch (reason) {
      if (generation.current === current) {
        setError(reason instanceof Error ? reason : new Error(String(reason)))
      }
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, dependencies)

  useEffect(() => {
    void refresh()
    return () => {
      generation.current += 1
    }
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useTheme(): AsyncValue<Theme> {
  const client = useExtensionClient()
  const value = useAsyncValue(() => client.ui.getTheme(), [client])
  const [eventTheme, setEventTheme] = useState<Theme>()
  useEffect(() => {
    const disposable = client.ui.onDidChangeTheme(setEventTheme)
    return () => void disposable.dispose()
  }, [client])
  return eventTheme ? { ...value, data: eventTheme, loading: false } : value
}

export function useLocale(): AsyncValue<Locale> {
  const client = useExtensionClient()
  const value = useAsyncValue(() => client.ui.getLocale(), [client])
  const [eventLocale, setEventLocale] = useState<Locale>()
  useEffect(() => {
    const disposable = client.ui.onDidChangeLocale(setEventLocale)
    return () => void disposable.dispose()
  }, [client])
  return eventLocale ? { ...value, data: eventLocale, loading: false } : value
}

export interface ViewStateResult<T extends JsonValue> {
  readonly state: T
  readonly setState: Dispatch<SetStateAction<T>>
  readonly loading: boolean
  readonly saving: boolean
  readonly error: Error | undefined
}

export function useViewState<T extends JsonValue>(initialState: T): ViewStateResult<T> {
  const client = useExtensionClient()
  const [state, setStateValue] = useState(initialState)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error>()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void client.ui
      .getViewState<T>()
      .then((restored) => {
        if (mounted.current && restored !== undefined) setStateValue(restored)
      })
      .catch((reason) => {
        if (mounted.current) setError(reason instanceof Error ? reason : new Error(String(reason)))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
    return () => {
      mounted.current = false
    }
  }, [client])

  const setState: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      setStateValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (value: T) => T)(previous) : next
        setSaving(true)
        setError(undefined)
        void client.ui
          .setViewState(resolved)
          .catch((reason) => {
            if (mounted.current) setError(reason instanceof Error ? reason : new Error(String(reason)))
          })
          .finally(() => {
            if (mounted.current) setSaving(false)
          })
        return resolved
      })
    },
    [client]
  )

  return { state, setState, loading, saving, error }
}

export function useHostMessage(channel?: string): HostMessage | undefined {
  const client = useExtensionClient()
  const [message, setMessage] = useState<HostMessage>()
  useEffect(() => {
    const disposable = client.ui.onDidReceiveMessage((next) => {
      if (!channel || next.channel === channel) setMessage(next)
    })
    return () => void disposable.dispose()
  }, [client, channel])
  return message
}

export function usePostHostMessage(): (message: HostMessage) => Promise<void> {
  const client = useExtensionClient()
  return useCallback((message) => client.ui.postMessage(message), [client])
}

export interface CommandHookResult<TResult extends JsonValue = JsonValue> {
  readonly result: TResult | undefined
  readonly executing: boolean
  readonly error: Error | undefined
  readonly execute: (args?: JsonValue) => Promise<TResult>
  readonly reset: () => void
}

/** Invoke a documented host/extension command without depending on Electron. */
export function useCommand<TResult extends JsonValue = JsonValue>(commandId: string): CommandHookResult<TResult> {
  const client = useExtensionClient()
  const [result, setResult] = useState<TResult>()
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<Error>()
  const generation = useRef(0)

  useEffect(() => () => {
    generation.current += 1
  }, [])

  const execute = useCallback(async (args?: JsonValue): Promise<TResult> => {
    const current = ++generation.current
    setExecuting(true)
    setError(undefined)
    try {
      const value = await client.commands.executeCommand<TResult>(commandId, args)
      if (generation.current === current) setResult(value)
      return value
    } catch (reason) {
      const normalized = reason instanceof Error ? reason : new Error(String(reason))
      if (generation.current === current) setError(normalized)
      throw normalized
    } finally {
      if (generation.current === current) setExecuting(false)
    }
  }, [client, commandId])

  const reset = useCallback(() => {
    generation.current += 1
    setResult(undefined)
    setError(undefined)
    setExecuting(false)
  }, [])

  return { result, executing, error, execute, reset }
}

export interface AgentRunHookResult {
  readonly run: AgentRun | undefined
  readonly events: readonly AgentRunEvent[]
  readonly loading: boolean
  readonly error: Error | undefined
  readonly cancel: (reason?: string) => Promise<void>
  readonly refresh: () => Promise<void>
}

export function useAgentRun(runId: string | undefined): AgentRunHookResult {
  const client = useExtensionClient()
  const [run, setRun] = useState<AgentRun>()
  const [events, setEvents] = useState<AgentRunEvent[]>([])
  const [loading, setLoading] = useState(Boolean(runId))
  const [error, setError] = useState<Error>()
  const refreshGeneration = useRef(0)

  const refresh = useCallback(async () => {
    if (!runId) return
    const generation = ++refreshGeneration.current
    setLoading(true)
    try {
      const next = await client.agent.getRun(runId)
      if (refreshGeneration.current === generation) {
        setRun(next)
        setError(undefined)
      }
    } catch (reason) {
      if (refreshGeneration.current === generation) {
        setError(reason instanceof Error ? reason : new Error(String(reason)))
      }
    } finally {
      if (refreshGeneration.current === generation) setLoading(false)
    }
  }, [client, runId])

  useEffect(() => {
    if (!runId) {
      setRun(undefined)
      setEvents([])
      setLoading(false)
      return
    }
    let disposed = false
    let subscription: { dispose(): void | Promise<void> } | undefined
    let eventSubscription: { dispose(): void | Promise<void> } | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryAttempt = 0
    let lastSequence = 0
    let connectionGeneration = 0
    let terminal = false
    let reconnecting = false
    setEvents([])
    void refresh()
    const connect = async (): Promise<void> => {
      const generation = ++connectionGeneration
      try {
        const created = await client.agent.subscribe({ runId, afterSequence: lastSequence })
        if (disposed || generation !== connectionGeneration) {
          await created.dispose()
          return
        }
        subscription = created
        retryAttempt = 0
        setError(undefined)
        let terminalSeen = false
        let nextEventSubscription: { dispose(): void | Promise<void> } | undefined
        nextEventSubscription = created.onEvent((event) => {
          if (disposed || event.runId !== runId || event.sequence <= lastSequence) return
          lastSequence = event.sequence
          setEvents((current) => {
            if (current.some((candidate) => candidate.sequence === event.sequence)) return current
            return [...current, event]
              .sort((left, right) => left.sequence - right.sequence)
              .slice(-MAX_RETAINED_AGENT_EVENTS)
          })
          if (event.type === 'state' || event.type === 'terminal') void refresh()
          if (event.type === 'terminal') {
            terminalSeen = true
            terminal = true
            if (nextEventSubscription) {
              void nextEventSubscription.dispose()
              if (eventSubscription === nextEventSubscription) eventSubscription = undefined
              void created.dispose()
              if (subscription === created) subscription = undefined
            }
          }
        })
        if (terminalSeen) {
          void nextEventSubscription?.dispose()
          void created.dispose()
          if (subscription === created) subscription = undefined
        } else {
          eventSubscription = nextEventSubscription
        }
      } catch (reason) {
        if (disposed || generation !== connectionGeneration) return
        setError(reason instanceof Error ? reason : new Error(String(reason)))
        if (
          typeof reason === 'object' &&
          reason !== null &&
          'retryable' in reason &&
          reason.retryable === false
        ) return
        const delay = Math.min(
          MAX_AGENT_SUBSCRIBE_RETRY_MS,
          250 * (2 ** Math.min(retryAttempt, 5))
        )
        retryAttempt += 1
        retryTimer = setTimeout(() => void connect(), delay)
      }
    }
    const reconnect = async (): Promise<void> => {
      if (disposed || terminal || reconnecting) return
      reconnecting = true
      connectionGeneration += 1
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      const previousEvents = eventSubscription
      const previousSubscription = subscription
      eventSubscription = undefined
      subscription = undefined
      try {
        await previousEvents?.dispose()
        await previousSubscription?.dispose()
        if (!disposed && !terminal) await connect()
      } finally {
        reconnecting = false
      }
    }
    const overflowSubscription = client.ui.onDidReceiveMessage((message) => {
      if (message.channel === 'kun.extension.view.overflow') void reconnect()
    })
    void connect()
    return () => {
      disposed = true
      connectionGeneration += 1
      refreshGeneration.current += 1
      if (retryTimer) clearTimeout(retryTimer)
      void overflowSubscription.dispose()
      void eventSubscription?.dispose()
      void subscription?.dispose()
    }
  }, [client, refresh, runId])

  const cancel = useCallback(
    async (reason?: string) => {
      if (!runId) return
      const result = await client.agent.cancel({ runId, reason })
      setRun(result.run)
    },
    [client, runId]
  )

  return { run, events, loading, error, cancel, refresh }
}

export function useAccounts(providerId?: string): AsyncValue<Account[]> {
  const client = useExtensionClient()
  return useAsyncValue(
    () => client.authentication.listAccounts({ providerId, includeUnavailable: true }),
    [client, providerId]
  )
}

export function useProviderStatus(providerId: string | undefined): AsyncValue<ProviderStatus> {
  const client = useExtensionClient()
  const value = useAsyncValue(
    async () => {
      if (!providerId) throw new Error('providerId is required')
      return client.modelProviders.getStatus(providerId)
    },
    [client, providerId]
  )
  const [eventStatus, setEventStatus] = useState<ProviderStatus>()
  useEffect(() => {
    const disposable = client.ui.onDidChangeProviderStatus((status) => {
      if (status.providerId === providerId) setEventStatus(status)
    })
    return () => void disposable.dispose()
  }, [client, providerId])
  return eventStatus ? { ...value, data: eventStatus, loading: false } : value
}

export interface ConfigurationHookResult<T extends JsonValue> extends AsyncValue<T | undefined> {
  readonly updating: boolean
  readonly update: (value: T) => Promise<void>
}

export function useConfiguration<T extends JsonValue = JsonValue>(
  sectionId: string,
  key: string
): ConfigurationHookResult<T> {
  const client = useExtensionClient()
  const value = useAsyncValue(
    () => client.configuration.get<T>(sectionId, key),
    [client, sectionId, key]
  )
  const [eventValue, setEventValue] = useState<T>()
  const [updating, setUpdating] = useState(false)
  useEffect(() => {
    setEventValue(undefined)
    const disposable = client.configuration.onDidChange((change) => {
      if (change.sectionId === sectionId && change.key === key) setEventValue(change.value as T)
    })
    return () => void disposable.dispose()
  }, [client, key, sectionId])
  const update = useCallback(async (next: T) => {
    setUpdating(true)
    try {
      await client.configuration.update(sectionId, key, next)
      setEventValue(next)
    } finally {
      setUpdating(false)
    }
  }, [client, key, sectionId])
  return {
    ...value,
    data: eventValue === undefined ? value.data : eventValue,
    updating,
    update
  }
}

export interface AsyncBoundaryProps<T> {
  value: AsyncValue<T>
  loading?: ReactNode
  error?: (error: Error, retry: () => Promise<void>) => ReactNode
  children: (data: T) => ReactNode
}

export function ExtensionAsyncBoundary<T>({
  value,
  loading = 'Loading…',
  error = (reason, retry) =>
    createElement(
      'div',
      { role: 'alert' },
      reason.message,
      createElement('button', { type: 'button', onClick: () => void retry() }, 'Retry')
    ),
  children
}: AsyncBoundaryProps<T>) {
  if (value.loading) return createElement('div', { 'aria-busy': true }, loading)
  if (value.error) return error(value.error, value.refresh)
  return value.data === undefined ? null : children(value.data)
}

export interface AgentRunStatusProps {
  value: AgentRunHookResult
  showCancel?: boolean
}

export function AgentRunStatus({ value, showCancel = true }: AgentRunStatusProps) {
  const cancellable = value.run && !['completed', 'failed', 'cancelled', 'budget-exhausted'].includes(value.run.state)
  return createElement(
    'div',
    { 'aria-live': 'polite', 'aria-busy': value.loading },
    value.error ? createElement('span', { role: 'alert' }, value.error.message) : null,
    createElement('span', null, value.run?.state ?? (value.loading ? 'loading' : 'idle')),
    showCancel && cancellable
      ? createElement('button', { type: 'button', onClick: () => void value.cancel() }, 'Cancel')
      : null
  )
}
