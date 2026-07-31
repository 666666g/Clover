import { describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '../shared/app-settings'
import { WeixinTransportAdapter } from './weixin-transport-adapter'

function channel(): ClawImChannelV1 {
  return {
    id: 'weixin_1', provider: 'weixin', label: 'WeChat', enabled: true, model: 'auto',
    threadId: '', workspaceRoot: '/workspace', conversations: [], welcomeSentAt: '',
    platformCredential: {
      kind: 'weixin', accountId: 'account_1', sessionKey: '', createdAt: '2026-07-11T00:00:00.000Z'
    },
    agentProfile: { name: 'kun', description: '', identity: '', personality: '', userContext: '', replyRules: '' },
    createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z'
  }
}

describe('Weixin transport adapter', () => {
  it('preserves legacy nested webhook session fields and deterministic message-id fallback', () => {
    const adapter = new WeixinTransportAdapter({
      logError: vi.fn(),
      createMessageId: () => 'generated'
    })
    expect(adapter.legacyRemoteSession({
      message: { chat_id: 'legacy_chat', sender: 'legacy_sender' },
      data: { thread_id: 'legacy_thread' }
    }, 'Alice')).toEqual({
      chatId: 'legacy_chat',
      messageId: 'wx_generated',
      threadId: 'legacy_thread',
      senderId: 'legacy_sender',
      senderName: 'legacy_sender'
    })
    expect(adapter.legacyRemoteSession({}, 'webhook')).toBeNull()
  })

  it('delivers text and files through one account/recipient resolution path', async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'message_1' }))
    const adapter = new WeixinTransportAdapter({ send, logError: vi.fn() })
    const remoteSession = { chatId: 'user_1' }
    await expect(adapter.sendText({
      channel: channel(), remoteSession, text: 'hello', failureMessage: 'failed'
    })).resolves.toEqual({ ok: true })
    await expect(adapter.sendFiles({
      channel: channel(), remoteSession,
      files: [{ path: '/workspace/report.pdf', fileName: 'report.pdf' }],
      failureMessage: 'failed'
    })).resolves.toEqual({ ok: true })
    expect(send).toHaveBeenNthCalledWith(1, { accountId: 'account_1', to: 'user_1', text: 'hello' })
    expect(send).toHaveBeenNthCalledWith(2, {
      accountId: 'account_1', to: 'user_1',
      files: [{ path: '/workspace/report.pdf', fileName: 'report.pdf' }]
    })
  })

  it('logs a Weixin delivery failure without mutating channel state', async () => {
    const original = channel()
    const logError = vi.fn()
    const adapter = new WeixinTransportAdapter({
      send: vi.fn(async () => ({ ok: false as const, message: 'bridge offline' })),
      logError
    })
    await expect(adapter.sendText({
      channel: original,
      remoteSession: { chatId: 'user_1' },
      text: 'hello',
      failureMessage: 'Failed to push'
    })).resolves.toEqual({ ok: false, message: 'bridge offline' })
    expect(original).toEqual(channel())
    expect(logError).toHaveBeenCalledWith('claw-weixin', 'Failed to push', expect.objectContaining({
      channelId: 'weixin_1', message: 'bridge offline'
    }))
  })
})
