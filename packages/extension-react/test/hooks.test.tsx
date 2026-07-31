import React, { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createExtensionTestHarness } from '@kun/extension-test'
import {
  ExtensionViewProvider,
  useAgentRun,
  useCommand,
  useConfiguration,
  useHostMessage,
  useLocale,
  useTheme,
  useViewState
} from '../src/index.js'

describe('@kun/extension-react', () => {
  it('invokes commands through the framework-neutral client and exposes execution state', async () => {
    const harness = createExtensionTestHarness({ permissions: ['commands.register'] })
    await harness.client.commands.registerCommand('sum', (args) => {
      const values = args as { left: number; right: number }
      return values.left + values.right
    })
    let command: ReturnType<typeof useCommand<number>> | undefined
    function Probe() {
      command = useCommand<number>('sum')
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        <ExtensionViewProvider client={harness.client}>
          <Probe />
        </ExtensionViewProvider>
      )
    })
    await act(async () => {
      await expect(command!.execute({ left: 2, right: 3 })).resolves.toBe(5)
    })
    expect(command).toMatchObject({ result: 5, executing: false, error: undefined })

    await act(async () => renderer?.unmount())
    await harness.dispose()
  })

  it('loads and updates extension-scoped configuration through the public API', async () => {
    const harness = createExtensionTestHarness({ permissions: ['ui.actions'] })
    let setting: ReturnType<typeof useConfiguration<string>> | undefined
    function Probe() {
      setting = useConfiguration<string>('general', 'mode')
      return null
    }
    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        <ExtensionViewProvider client={harness.client}>
          <Probe />
        </ExtensionViewProvider>
      )
    })
    await act(async () => {
      await setting!.update('safe')
    })
    expect(setting).toMatchObject({ data: 'safe', updating: false })
    await act(async () => renderer?.unmount())
    await harness.dispose()
  })

  it('tracks host theme, message, and durable view state without Electron', async () => {
    const harness = createExtensionTestHarness({ permissions: ['agent.run'] })
    harness.webview.state = { count: 2 }
    const samples: unknown[] = []

    function Probe() {
      const theme = useTheme()
      const locale = useLocale()
      const view = useViewState({ count: 0 })
      const message = useHostMessage('refresh')
      useEffect(() => {
        samples.push({
          theme: theme.data?.kind,
          locale: locale.data?.language,
          state: view.state,
          message: message?.payload
        })
      }, [locale.data, message, theme.data, view.state])
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        <ExtensionViewProvider client={harness.client}>
          <Probe />
        </ExtensionViewProvider>
      )
    })
    await act(async () => {
      harness.webview.setTheme(harness.transport, {
        kind: 'light',
        tokens: { foreground: '#111' },
        zoomFactor: 1,
        reducedMotion: false
      })
      harness.webview.setLocale(harness.transport, {
        language: 'zh',
        direction: 'ltr',
        messages: {}
      })
      harness.webview.sendMessage(harness.transport, 'refresh', { reason: 'test' })
    })

    expect(samples).toContainEqual({
      theme: 'light',
      locale: 'zh',
      state: { count: 2 },
      message: { reason: 'test' }
    })

    await act(async () => renderer?.unmount())
    await harness.dispose()
  })

  it('does not lose pre-listener Agent events and keeps the React stream bounded', async () => {
    const harness = createExtensionTestHarness({ permissions: ['agent.run'] })
    const { run } = harness.agent.createRun({ input: 'hello' })
    const replay = harness.agent.events.get(run.id)![0]!
    const early = harness.agent.emit(run.id, 'progress', { message: 'early' })
    harness.transport.handle('agent.subscribe', () => {
      harness.transport.emit('agent.event', {
        subscriptionId: 'view-subscription',
        event: early
      })
      return { subscriptionId: 'view-subscription', replay: [replay] }
    })

    let latest: ReturnType<typeof useAgentRun> | undefined
    function Probe() {
      latest = useAgentRun(run.id)
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        <ExtensionViewProvider client={harness.client}>
          <Probe />
        </ExtensionViewProvider>
      )
    })
    await act(async () => {
      await vi.waitFor(() => expect(latest?.events).toHaveLength(2))
    })
    expect(latest?.events.map((event) => event.type)).toEqual(['state', 'progress'])

    await act(async () => {
      const live = harness.agent.emit(run.id, 'progress', { message: 'live' })
      harness.transport.emit('agent.event', {
        subscriptionId: 'view-subscription',
        event: live
      })
      harness.transport.emit('agent.event', {
        subscriptionId: 'view-subscription',
        event: live
      })
    })
    await act(async () => {
      harness.webview.sendMessage(harness.transport, 'kun.extension.view.overflow', {
        code: 'cursor_expired',
        oldestAvailableCursor: 4
      })
      await vi.waitFor(() => {
        expect(harness.transport.requests.filter(({ method }) => method === 'agent.subscribe')).toHaveLength(2)
      })
    })
    expect(harness.transport.requests.filter(({ method }) => method === 'agent.subscribe').at(-1)?.params)
      .toMatchObject({ runId: run.id, afterSequence: 3 })

    await act(async () => {
      for (let index = 0; index < 520; index += 1) {
        const event = harness.agent.emit(run.id, 'progress', { message: `event-${index}` })
        harness.transport.emit('agent.event', {
          subscriptionId: 'view-subscription',
          event
        })
      }
    })

    expect(latest?.events).toHaveLength(512)
    expect(latest?.events.at(-1)?.sequence).toBe(harness.agent.events.get(run.id)!.at(-1)!.sequence)
    await act(async () => renderer?.unmount())
    expect(harness.transport.requests.filter(({ method }) => method === 'agent.unsubscribe')).toHaveLength(2)
    await harness.dispose()
  })

  it('re-subscribes to the selected run and disposes the prior stream on run changes', async () => {
    const harness = createExtensionTestHarness({ permissions: ['agent.run'] })
    const first = harness.agent.createRun({ input: 'first' }).run
    const second = harness.agent.createRun({ input: 'second' }).run
    let selected = first.id
    let latest: ReturnType<typeof useAgentRun> | undefined

    function Probe({ runId }: { runId: string }) {
      latest = useAgentRun(runId)
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        <ExtensionViewProvider client={harness.client}>
          <Probe runId={selected} />
        </ExtensionViewProvider>
      )
    })
    selected = second.id
    await act(async () => {
      renderer?.update(
        <ExtensionViewProvider client={harness.client}>
          <Probe runId={selected} />
        </ExtensionViewProvider>
      )
    })
    await act(async () => {
      await vi.waitFor(() => {
        expect(harness.transport.requests.filter(({ method }) => method === 'agent.subscribe')).toHaveLength(2)
      })
    })
    await act(async () => {
      harness.agent.emit(first.id, 'progress', { message: 'stale' })
      harness.agent.emit(second.id, 'progress', { message: 'current' })
    })
    await act(async () => {
      await vi.waitFor(() => expect(latest?.events.some((event) => event.type === 'progress')).toBe(true))
    })

    expect(latest?.events.every((event) => event.runId === second.id)).toBe(true)
    expect(latest?.events.some((event) => event.type === 'progress')).toBe(true)
    expect(harness.transport.requests.filter(({ method }) => method === 'agent.subscribe')).toHaveLength(2)
    expect(harness.transport.requests.filter(({ method }) => method === 'agent.unsubscribe')).toHaveLength(1)

    await act(async () => renderer?.unmount())
    await harness.dispose()
  })
})
