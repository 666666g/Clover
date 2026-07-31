import type {
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1
} from '../shared/app-settings'
import type { TelegramRuntime } from './telegram-runtime'
import type { FeishuTransportAdapter } from './feishu-transport-adapter'
import type { WeixinRemoteSession, WeixinTransportAdapter } from './weixin-transport-adapter'
import { formatFeishuMirrorText } from './claw-runtime-helpers'

type RemoteRecipient = Pick<ClawImRemoteSessionV1, 'chatId'>

/** Central platform dispatch for channel-independent reply lifecycle operations. */
export class ImTransportRouter {
  constructor(private readonly deps: {
    feishu: FeishuTransportAdapter
    weixin: WeixinTransportAdapter
    telegram?: TelegramRuntime
    logError: (category: string, message: string, detail?: unknown) => void
  }) {}

  canPush(channel: ClawImChannelV1): boolean {
    if (channel.provider === 'feishu') return this.deps.feishu.has(channel.id)
    if (channel.provider === 'weixin') return this.deps.weixin.canSend(channel)
    if (channel.provider === 'telegram') return Boolean(this.deps.telegram?.has(channel.id))
    return false
  }

  legacyRemoteSession(
    provider: ClawImChannelV1['provider'],
    payload: Record<string, unknown>,
    sender: string
  ): WeixinRemoteSession | null {
    return provider === 'weixin' ? this.deps.weixin.legacyRemoteSession(payload, sender) : null
  }

  async pushWelcome(input: {
    channel: ClawImChannelV1
    remoteSession?: RemoteRecipient
    text: string
  }): Promise<boolean> {
    if (input.channel.provider !== 'weixin') return false
    const result = await this.deps.weixin.sendText({
      channel: input.channel,
      remoteSession: input.remoteSession,
      text: input.text,
      failureMessage: 'Failed to push the WeChat welcome message; prepending it to the reply instead.'
    })
    return result.ok
  }

  async sendText(input: {
    channel: ClawImChannelV1
    remoteSession?: RemoteRecipient
    text: string
    context?: Record<string, unknown>
  }): Promise<void> {
    const to = recipient(input.channel, input.remoteSession)
    if (!to) return
    if (input.channel.provider === 'weixin') {
      await this.deps.weixin.sendText({
        channel: input.channel,
        remoteSession: input.remoteSession,
        text: input.text,
        failureMessage: 'Failed to push delayed result over the WeChat bridge.',
        context: input.context
      })
      return
    }
    if (input.channel.provider === 'feishu') {
      await this.deps.feishu.sendText(input.channel.id, to, input.text, input.context)
      return
    }
    if (input.channel.provider === 'telegram' && this.deps.telegram) {
      const result = await this.deps.telegram.sendMessage(input.channel.id, to, input.text)
      if (!result.ok) this.deps.logError('claw-telegram', 'Failed to push delayed result over Telegram.', {
        ...input.context, channelId: input.channel.id, chatId: to, message: result.message
      })
    }
  }

  async sendFiles(input: {
    channel: ClawImChannelV1
    remoteSession?: RemoteRecipient
    files: readonly ClawGeneratedFileV1[]
    context?: Record<string, unknown>
  }): Promise<void> {
    if (input.files.length === 0) return
    const to = recipient(input.channel, input.remoteSession)
    if (!to) return
    if (input.channel.provider === 'weixin') {
      await this.deps.weixin.sendFiles({
        channel: input.channel,
        remoteSession: input.remoteSession,
        files: input.files,
        failureMessage: 'Failed to push delayed generated files over the WeChat bridge.',
        context: input.context
      })
      return
    }
    if (input.channel.provider === 'feishu') {
      await this.deps.feishu.sendFiles(input.channel.id, to, input.files, input.context)
      return
    }
    if (input.channel.provider === 'telegram' && this.deps.telegram) {
      for (const file of input.files) {
        const result = await this.deps.telegram.sendFile(
          input.channel.id, to, file.path, file.fileName
        )
        if (!result.ok) this.deps.logError(
          'claw-telegram',
          'Failed to push delayed generated file over Telegram.',
          {
            ...input.context,
            channelId: input.channel.id,
            chatId: to,
            filePath: file.path,
            fileName: file.fileName,
            message: result.message
          }
        )
      }
    }
  }

  async mirror(input: {
    channel: ClawImChannelV1
    conversation?: ClawImConversationV1
    threadId: string
    text: string
    direction: 'user' | 'assistant'
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    if (input.channel.provider === 'weixin') return this.deps.weixin.mirror(input)
    if (input.channel.provider !== 'feishu') {
      return { ok: false, message: 'Unsupported IM provider.' }
    }
    const conversation = input.conversation ??
      [...input.channel.conversations]
        .filter((item) => item.localThreadId.trim() === input.threadId.trim())
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    if (!conversation?.chatId.trim()) {
      return { ok: false, message: 'No target Feishu / Lark conversation is available yet.' }
    }
    const result = await this.deps.feishu.sendText(
      input.channel.id,
      conversation.chatId,
      formatFeishuMirrorText(input.text, input.direction).markdown,
      {
        purpose: 'mirror',
        threadId: input.threadId,
        direction: input.direction,
        channelId: input.channel.id,
        chatId: conversation.chatId
      }
    )
    if (!result.ok) this.deps.logError('claw-feishu', 'Failed to mirror Claw message to Feishu / Lark', {
      message: result.message,
      threadId: input.threadId,
      direction: input.direction
    })
    return result
  }
}

function recipient(channel: ClawImChannelV1, remoteSession?: RemoteRecipient): string {
  return remoteSession?.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
}
