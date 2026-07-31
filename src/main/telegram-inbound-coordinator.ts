import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1,
  ClawRunResult
} from '../shared/app-settings'
import {
  IM_COMPLETED_NO_TEXT_REPLY,
  IM_PROCESSING_ACK,
  replyTextForGeneratedFiles,
  shouldSendGeneratedFilesForPrompt,
  type ClawRuntimeDeps
} from './claw-runtime-helpers'
import { findClawConversation } from './claw-conversation-registry'
import type { TelegramInboundPayload, TelegramRuntime } from './telegram-runtime'

const TELEGRAM_INBOUND_IMAGE_HEADING = '[Telegram inbound message]'

export type ImIncomingRemoteSession = Pick<
  ClawImRemoteSessionV1,
  'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'
>

export type TelegramInboundCoordinatorDeps = {
  loadSettings: () => Promise<AppSettingsV1>
  telegramRuntime?: TelegramRuntime
  resolveIncomingWorkspaceRoot: (
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    conversation: ClawImConversationV1 | undefined,
    remoteSession: ImIncomingRemoteSession
  ) => string
  resolveChannelWorkspaceRoot: (settings: AppSettingsV1, channel: ClawImChannelV1) => string
  pendingWelcomeText: (settings: AppSettingsV1, channel: ClawImChannelV1) => string
  beginWelcome: (channelId: string) => void
  endWelcome: (channelId: string) => void
  markWelcomeSent: (channelId: string) => Promise<void>
  handleCommand: (
    settings: AppSettingsV1,
    input: {
      text: string
      channel: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession: ImIncomingRemoteSession
    }
  ) => Promise<string | null>
  resolveModel: (
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    conversation: ClawImConversationV1 | undefined
  ) => { providerId: string; model: string }
  createScheduledTaskFromText?: ClawRuntimeDeps['createScheduledTaskFromText']
  processPrompt: (
    settings: AppSettingsV1,
    input: {
      prompt: string
      sender: string
      provider: 'telegram'
      channel: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession: ImIncomingRemoteSession
    }
  ) => Promise<ClawRunResult>
  scheduleResultPush: (
    settings: AppSettingsV1,
    input: {
      channel: ClawImChannelV1
      remoteSession: ImIncomingRemoteSession
      threadId: string
      turnId?: string
      workspaceRoot: string
    }
  ) => void
  resolveGeneratedFiles: (
    files: readonly ClawGeneratedFileV1[],
    workspaceRoot: string,
    context: Record<string, unknown>
  ) => Promise<ClawGeneratedFileV1[]>
  formatError: (settings: AppSettingsV1, message: string) => string
  logError: ClawRuntimeDeps['logError']
}

/** Owns Telegram-specific inbound sequencing; shared conversation state stays in Claw. */
export async function handleTelegramInbound(
  payload: TelegramInboundPayload,
  deps: TelegramInboundCoordinatorDeps
): Promise<void> {
  const settings = await deps.loadSettings()
  const channel = settings.claw.channels.find((item) => item.id === payload.channelId && item.enabled)
  const telegram = deps.telegramRuntime
  if (!channel || channel.provider !== 'telegram' || !telegram?.has(channel.id)) return

  const remoteSession: ImIncomingRemoteSession = {
    chatId: payload.chatId,
    messageId: payload.messageId,
    threadId: '',
    senderId: payload.senderId,
    senderName: payload.senderName
  }
  const conversation = findClawConversation(channel, remoteSession)
  const workspaceRoot = deps.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession)
  const text = payload.text.trim()
  const localFilePath = payload.localFilePath?.trim() || ''

  const welcomeText = deps.pendingWelcomeText(settings, channel)
  if (welcomeText) {
    deps.beginWelcome(channel.id)
    try {
      const to = remoteSession.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
      if (to) {
        const result = await telegram.sendMessage(channel.id, to, welcomeText)
        if (!result.ok) {
          deps.logError('claw-telegram', 'Failed to push the Telegram welcome message; prepending it to the reply instead.', {
            channelId: channel.id,
            message: result.message
          })
        }
      }
      await deps.markWelcomeSent(channel.id)
    } catch (error) {
      deps.logError('claw-telegram', 'Failed to send the Telegram welcome message; it will be retried on the next inbound message.', {
        message: errorMessage(error),
        channelId: channel.id,
        chatId: remoteSession.chatId
      })
    } finally {
      deps.endWelcome(channel.id)
    }
  }

  const commandReply = await deps.handleCommand(settings, { text, channel, conversation, remoteSession })
  if (commandReply !== null) {
    await telegram.sendMessage(channel.id, remoteSession.chatId, commandReply)
    return
  }

  const model = deps.resolveModel(settings, channel, conversation)
  const taskCreation = await deps.createScheduledTaskFromText?.(text, {
    workspaceRoot: deps.resolveChannelWorkspaceRoot(settings, channel),
    clawChannelId: channel.id,
    providerId: model.providerId,
    modelHint: model.model,
    mode: settings.claw.im.mode
  }) ?? { kind: 'noop' as const }
  if (taskCreation.kind === 'created') {
    await telegram.sendMessage(channel.id, remoteSession.chatId, taskCreation.confirmationText)
    return
  }
  if (taskCreation.kind === 'error') {
    await telegram.sendMessage(
      channel.id,
      remoteSession.chatId,
      deps.formatError(settings, `Failed to create the scheduled task: ${taskCreation.message}`)
    )
    return
  }

  const promptText = localFilePath && !text
    ? `${TELEGRAM_INBOUND_IMAGE_HEADING}\nSender: ${payload.senderName}\n\n[image attachment]`
    : localFilePath
      ? `${TELEGRAM_INBOUND_IMAGE_HEADING}\nSender: ${payload.senderName}\n\n${text}`
      : text
  if (!promptText.trim()) {
    await telegram.sendMessage(channel.id, remoteSession.chatId, 'Only text and image messages are supported right now.')
    return
  }

  const result = await deps.processPrompt(settings, {
    prompt: promptText,
    sender: payload.senderName,
    provider: 'telegram',
    channel,
    conversation,
    remoteSession
  })
  if (!result.ok) {
    deps.logError('claw-telegram', 'Telegram inbound prompt failed.', {
      channelId: channel.id,
      chatId: remoteSession.chatId,
      message: result.message
    })
    await telegram.sendMessage(
      channel.id,
      remoteSession.chatId,
      deps.formatError(settings, `处理失败：${result.message}`)
    )
    return
  }
  if (result.completed === false) {
    deps.scheduleResultPush(settings, {
      channel,
      remoteSession,
      threadId: result.threadId,
      turnId: result.turnId,
      workspaceRoot
    })
    await telegram.sendMessage(channel.id, remoteSession.chatId, IM_PROCESSING_ACK)
    return
  }
  const generatedFiles = result.files ?? []
  const filesToSend = generatedFiles.length > 0 || shouldSendGeneratedFilesForPrompt(promptText)
    ? await deps.resolveGeneratedFiles(generatedFiles, workspaceRoot, {
        purpose: 'telegram-agent-file-resolve',
        channelId: channel.id,
        chatId: remoteSession.chatId,
        inboundMessageId: remoteSession.messageId,
        threadId: result.threadId,
        turnId: result.turnId
      })
    : []
  const reply = replyTextForGeneratedFiles(
    (result.text ?? '').trim() || IM_COMPLETED_NO_TEXT_REPLY,
    filesToSend
  )
  await telegram.sendMessage(channel.id, remoteSession.chatId, reply)
  for (const file of filesToSend) {
    const delivery = await telegram.sendFile(channel.id, remoteSession.chatId, file.path, file.fileName)
    if (!delivery.ok) {
      await telegram.sendMessage(
        channel.id,
        remoteSession.chatId,
        deps.formatError(settings, `Telegram 附件发送失败：${delivery.message}`)
      )
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
