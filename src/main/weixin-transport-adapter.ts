import { randomUUID } from 'node:crypto'
import type {
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1
} from '../shared/app-settings'
import { asString, nestedRecord } from './claw-runtime-helpers'

export type WeixinRemoteSession = Pick<
  ClawImRemoteSessionV1,
  'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'
>

export type WeixinTransportAdapterDeps = {
  send?: (options: {
    accountId: string
    to: string
    text?: string
    files?: readonly { path: string; fileName: string }[]
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  resolveAccountUserId?: (accountId: string) => Promise<string>
  logError: (category: string, message: string, detail?: unknown) => void
  createMessageId?: () => string
}

/** Owns WeChat bridge payload compatibility and outbound transport details. */
export class WeixinTransportAdapter {
  constructor(private readonly deps: WeixinTransportAdapterDeps) {}

  legacyRemoteSession(payload: Record<string, unknown>, senderLabel: string): WeixinRemoteSession | null {
    const message = nestedRecord(payload.message)
    const data = nestedRecord(payload.data)
    const chatId = asString(
      payload.chatId || payload.chat_id || payload.open_chat_id || payload.from ||
      payload.conversationId || payload.conversation_id || message.chatId || message.chat_id ||
      message.from || message.sender || data.chatId || data.chat_id || data.from || data.sender || senderLabel
    )
    if (!chatId || chatId === 'webhook' || chatId === 'WeChat') return null
    const messageId = asString(
      payload.messageId || payload.message_id || message.messageId || message.message_id ||
      data.messageId || data.message_id
    ) || `wx_${this.deps.createMessageId?.() ?? randomUUID()}`
    const threadId = asString(
      payload.threadId || payload.thread_id || message.threadId || message.thread_id ||
      data.threadId || data.thread_id
    )
    const senderId = asString(
      payload.senderId || payload.sender_id || message.senderId || message.sender_id || message.sender ||
      data.senderId || data.sender_id || data.sender
    ) || chatId
    const senderName = asString(
      payload.senderName || payload.sender_name || message.senderName || message.sender_name || message.sender ||
      data.senderName || data.sender_name || data.sender
    ) || chatId
    return { chatId, messageId, threadId, senderId, senderName }
  }

  canSend(channel: ClawImChannelV1): boolean {
    return channel.provider === 'weixin' && Boolean(this.accountId(channel) && this.deps.send)
  }

  async resolveOwner(channel: ClawImChannelV1): Promise<string> {
    const accountId = this.accountId(channel)
    if (!accountId || !this.deps.resolveAccountUserId) return ''
    return (await this.deps.resolveAccountUserId(accountId)).trim()
  }

  async sendText(input: {
    channel: ClawImChannelV1
    remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId'>
    text: string
    failureMessage: string
    context?: Record<string, unknown>
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const target = this.resolveTarget(input.channel, input.remoteSession)
    if (!target.ok) return target
    const result = await this.deps.send!({ accountId: target.accountId, to: target.to, text: input.text })
    if (!result.ok) {
      this.deps.logError('claw-weixin', input.failureMessage, {
        ...input.context,
        channelId: input.channel.id,
        to: target.to,
        message: result.message
      })
      return result
    }
    return { ok: true }
  }

  async sendFiles(input: {
    channel: ClawImChannelV1
    remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId'>
    files: readonly ClawGeneratedFileV1[]
    failureMessage: string
    context?: Record<string, unknown>
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const target = this.resolveTarget(input.channel, input.remoteSession)
    if (!target.ok) return target
    const result = await this.deps.send!({
      accountId: target.accountId,
      to: target.to,
      files: input.files.map((file) => ({ path: file.path, fileName: file.fileName }))
    })
    if (!result.ok) {
      this.deps.logError('claw-weixin', input.failureMessage, {
        ...input.context,
        channelId: input.channel.id,
        to: target.to,
        message: result.message
      })
      return result
    }
    return { ok: true }
  }

  async mirror(input: {
    channel: ClawImChannelV1
    conversation?: ClawImConversationV1
    text: string
    threadId: string
    direction: 'user' | 'assistant'
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const credential = input.channel.platformCredential
    if (credential?.kind !== 'weixin' || !credential.accountId.trim()) {
      return { ok: false, message: 'No target WeChat account is available yet.' }
    }
    const to = input.conversation?.chatId.trim() || input.channel.remoteSession?.chatId.trim() || ''
    if (!to) return { ok: false, message: 'No target WeChat conversation is available yet.' }
    if (!this.deps.send) return { ok: false, message: 'Built-in WeChat bridge is not initialized.' }
    const result = await this.deps.send({ accountId: credential.accountId, to, text: input.text })
    if (!result.ok) {
      this.deps.logError('claw-weixin', 'Failed to mirror Claw message to WeChat', {
        message: result.message,
        threadId: input.threadId,
        direction: input.direction,
        channelId: input.channel.id,
        to
      })
    }
    return result.ok ? { ok: true } : result
  }

  private accountId(channel: ClawImChannelV1): string {
    const credential = channel.platformCredential
    return credential?.kind === 'weixin' ? credential.accountId.trim() : ''
  }

  private resolveTarget(
    channel: ClawImChannelV1,
    remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId'>
  ): { ok: true; accountId: string; to: string } | { ok: false; message: string } {
    const accountId = this.accountId(channel)
    if (!accountId) return { ok: false, message: 'No target WeChat account is available yet.' }
    const to = remoteSession?.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
    if (!to) return { ok: false, message: 'No target WeChat conversation is available yet.' }
    if (!this.deps.send) return { ok: false, message: 'Built-in WeChat bridge is not initialized.' }
    return { ok: true, accountId, to }
  }
}
