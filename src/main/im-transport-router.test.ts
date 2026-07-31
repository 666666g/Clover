import { describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '../shared/app-settings'
import { ImTransportRouter } from './im-transport-router'

function channel(provider: 'feishu' | 'weixin' | 'telegram'): ClawImChannelV1 {
  return {
    id: `${provider}_1`, provider, label: provider, enabled: true, model: 'auto', threadId: '',
    workspaceRoot: '/workspace', conversations: [], welcomeSentAt: '',
    agentProfile: { name: 'kun', description: '', identity: '', personality: '', userContext: '', replyRules: '' },
    createdAt: '', updatedAt: ''
  }
}

describe('IM transport router', () => {
  it('routes a common reply to exactly one platform adapter', async () => {
    const feishuSend = vi.fn(async () => ({ ok: true as const }))
    const weixinSend = vi.fn(async () => ({ ok: true as const }))
    const telegramSend = vi.fn(async () => ({ ok: true as const }))
    const router = new ImTransportRouter({
      feishu: { has: () => true, sendText: feishuSend } as never,
      weixin: { canSend: () => true, sendText: weixinSend } as never,
      telegram: { has: () => true, sendMessage: telegramSend } as never,
      logError: vi.fn()
    })

    await router.sendText({ channel: channel('telegram'), remoteSession: { chatId: 'chat_1' }, text: 'hello' })

    expect(telegramSend).toHaveBeenCalledWith('telegram_1', 'chat_1', 'hello')
    expect(feishuSend).not.toHaveBeenCalled()
    expect(weixinSend).not.toHaveBeenCalled()
  })

  it('contains a platform file failure without invoking another adapter', async () => {
    const logError = vi.fn()
    const telegramSendFile = vi.fn(async () => ({ ok: false as const, message: 'offline' }))
    const feishuSendFiles = vi.fn()
    const weixinSendFiles = vi.fn()
    const router = new ImTransportRouter({
      feishu: { has: () => true, sendFiles: feishuSendFiles } as never,
      weixin: { canSend: () => true, sendFiles: weixinSendFiles } as never,
      telegram: { has: () => true, sendFile: telegramSendFile } as never,
      logError
    })
    await router.sendFiles({
      channel: channel('telegram'),
      remoteSession: { chatId: 'chat_1' },
      files: [{ path: '/workspace/report.pdf', fileName: 'report.pdf' }]
    })
    expect(telegramSendFile).toHaveBeenCalledTimes(1)
    expect(feishuSendFiles).not.toHaveBeenCalled()
    expect(weixinSendFiles).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'claw-telegram',
      'Failed to push delayed generated file over Telegram.',
      expect.objectContaining({ message: 'offline' })
    )
  })
})
