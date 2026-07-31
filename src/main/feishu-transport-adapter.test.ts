import { describe, expect, it, vi } from 'vitest'
import type { LarkChannel } from '@larksuiteoapi/node-sdk'
import { defaultClawSettings, type AppSettingsV1, type ClawImChannelV1 } from '../shared/app-settings'
import { FeishuTransportAdapter } from './feishu-transport-adapter'

function adapter(
  logError = vi.fn(),
  createChannel?: () => LarkChannel
): FeishuTransportAdapter {
  return new FeishuTransportAdapter({
    logError,
    onMessage: vi.fn(),
    allowedFileDirs: () => [],
    ...(createChannel ? { createChannel: createChannel as never } : {})
  })
}

function feishuSettings(): AppSettingsV1 {
  const channel: ClawImChannelV1 = {
    id: 'feishu_1',
    provider: 'feishu',
    label: 'Feishu',
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
      kind: 'feishu',
      appId: 'cli_test',
      appSecret: 'secret',
      domain: 'feishu',
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

describe('Feishu transport adapter', () => {
  it('falls back to a plain chat message when an inbound reply fails', async () => {
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })

    const result = await adapter(logError).send(
      { send } as unknown as LarkChannel,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: undefined, replyInThread: undefined }
    )
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      'Failed to send Feishu / Lark reply; falling back to plain chat message.',
      expect.objectContaining({
        channelId: 'channel_1',
        message: 'reply permission denied',
        purpose: 'agent-reply',
        replyTo: 'om_inbound',
        to: 'oc_chat_a'
      })
    )
  })

  it('preserves markdown input when retrying without reply metadata', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })

    const result = await adapter().send(
      { send } as unknown as LarkChannel,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: undefined, replyInThread: undefined }
    )
  })

  it('waits for a connecting channel and disconnects it during stop', async () => {
    let finishConnect!: () => void
    const connect = vi.fn(() => new Promise<void>((resolve) => {
      finishConnect = resolve
    }))
    const disconnect = vi.fn(async () => undefined)
    const bridge = {
      on: vi.fn(),
      connect,
      disconnect
    } as unknown as LarkChannel
    const runtime = adapter(vi.fn(), () => bridge)

    const syncing = runtime.sync(feishuSettings())
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    let stopped = false
    const stopping = runtime.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)

    finishConnect()
    await Promise.all([syncing, stopping])
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(runtime.channelRegistry.size).toBe(0)
  })
})
