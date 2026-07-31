import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultClawSettings, type AppSettingsV1, type ClawImChannelV1 } from '../shared/app-settings'
import {
  createTelegramRuntime,
  parseAllowedChatIds,
  verifyTelegramBotToken
} from './telegram-runtime'

vi.mock('electron', () => ({ net: {} }))

afterEach(() => {
  vi.unstubAllGlobals()
})

function telegramSettings(): AppSettingsV1 {
  const channel: ClawImChannelV1 = {
    id: 'telegram_1',
    provider: 'telegram',
    label: 'Telegram',
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '/tmp/workspace',
    agentProfile: {
      name: 'Kun',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'telegram',
      botToken: `123:${'a'.repeat(35)}`,
      botUsername: 'kun_test_bot',
      allowedChatIds: '',
      createdAt: '2026-07-11T00:00:00.000Z'
    },
    conversations: [],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z'
  }
  return {
    claw: {
      ...defaultClawSettings(),
      enabled: true,
      im: { ...defaultClawSettings().im, enabled: true },
      channels: [channel]
    }
  } as AppSettingsV1
}

describe('Telegram transport adapter', () => {
  it('normalizes the private-chat allowlist without retaining invalid or duplicate ids', () => {
    expect([...parseAllowedChatIds('123, 456 123, -1, nope, 0')]).toEqual([123, 456])
    expect(parseAllowedChatIds('')).toEqual(new Set())
  })

  it('rejects malformed bot tokens before any network request', async () => {
    await expect(verifyTelegramBotToken('not-a-token')).resolves.toEqual({
      ok: false,
      code: 'invalid_format',
      message: 'Invalid token format. Expected "<numeric-id>:<35+ chars>".'
    })
  })

  it('reports disconnected text and file delivery without invoking another channel', async () => {
    const logError = vi.fn()
    const onInbound = vi.fn()
    const runtime = createTelegramRuntime({ store: {} as never, logError, onInbound })

    await expect(runtime.sendMessage('missing', '123', 'hello')).resolves.toEqual({
      ok: false,
      message: 'Telegram channel is not connected.'
    })
    await expect(runtime.sendFile('missing', '123', '/tmp/report.txt')).resolves.toEqual({
      ok: false,
      message: 'Telegram channel is not connected.'
    })
    expect(onInbound).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it('aborts polling, awaits inbound work, and cannot restart after stop', async () => {
    let pollCount = 0
    let pollAborted = false
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      pollCount += 1
      if (pollCount === 1) {
        return new Response(JSON.stringify({
          ok: true,
          result: [{
            update_id: 7,
            message: {
              message_id: 8,
              chat: { id: 123, type: 'private' },
              from: { id: 123, first_name: 'Ada' },
              text: 'hello'
            }
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return await new Promise<Response>((_resolve, reject) => {
        const abort = (): void => {
          pollAborted = true
          reject(new DOMException('aborted', 'AbortError'))
        }
        if (init?.signal?.aborted) abort()
        else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    let releaseInbound!: () => void
    const onInbound = vi.fn(() => new Promise<void>((resolve) => {
      releaseInbound = resolve
    }))
    const runtime = createTelegramRuntime({ store: {} as never, logError: vi.fn(), onInbound })
    const settings = telegramSettings()
    runtime.sync(settings)

    await vi.waitFor(() => expect(onInbound).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    let stopped = false
    const stopping = runtime.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(pollAborted).toBe(true)

    releaseInbound()
    await stopping
    expect(stopped).toBe(true)
    expect(runtime.has('telegram_1')).toBe(false)

    runtime.sync(settings)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
