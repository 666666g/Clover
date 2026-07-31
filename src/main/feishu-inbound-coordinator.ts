import type {
  LarkChannel,
  NormalizedMessage,
  SendInput,
  SendOptions,
  SendResult
} from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1,
  ClawRunResult
} from '../shared/app-settings'
import {
  buildFeishuPrompt,
  feishuSenderLabel,
  replyTextForGeneratedFiles,
  shouldDirectSendExistingGeneratedFilesForPrompt,
  shouldSendGeneratedFilesForPrompt,
  type ClawRuntimeDeps
} from './claw-runtime-helpers'
import { findClawConversation } from './claw-conversation-registry'
import type { ImIncomingRemoteSession } from './telegram-inbound-coordinator'

export type FeishuInboundCoordinatorDeps = {
  getBridge: (channelId: string) => LarkChannel | undefined
  loadSettings: () => Promise<AppSettingsV1>
  rememberRemoteSession: (
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    remoteSession: ClawImRemoteSessionV1
  ) => Promise<void>
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
  sendMessage: (
    bridge: LarkChannel,
    to: string,
    input: SendInput,
    options: SendOptions,
    context: Record<string, unknown>
  ) => Promise<SendResult>
  sendGeneratedFiles: (
    bridge: LarkChannel,
    to: string,
    files: readonly ClawGeneratedFileV1[],
    options: SendOptions,
    context: Record<string, unknown>
  ) => Promise<{ sent: ClawGeneratedFileV1[]; failed: Array<{ file: ClawGeneratedFileV1; message: string }> }>
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
  formatError: (settings: AppSettingsV1, message: string) => string
  resolveGeneratedFiles: (
    files: readonly ClawGeneratedFileV1[],
    workspaceRoot: string,
    context: Record<string, unknown>
  ) => Promise<ClawGeneratedFileV1[]>
  recentGeneratedFiles: (
    settings: AppSettingsV1,
    threadId: string,
    workspaceRoot: string,
    context: Record<string, unknown>,
    turnId?: string
  ) => Promise<ClawGeneratedFileV1[]>
  processPrompt: (
    settings: AppSettingsV1,
    input: {
      prompt: string
      sender: string
      provider: 'feishu'
      channel: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession: ImIncomingRemoteSession
      waitForResult?: boolean
    }
  ) => Promise<ClawRunResult>
  runStreamingReply: (input: {
    bridge: LarkChannel
    chatId: string
    threadId: string
    turnId: string
    replyOptions: { replyTo?: string; replyInThread?: boolean }
    responseTimeoutMs: number
    context: Record<string, unknown>
  }) => Promise<{ ok: boolean; messageId: string; finalText: string; fellBack: boolean; message: string }>
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
  logError: ClawRuntimeDeps['logError']
}

/** Owns Feishu-specific inbound sequencing; common thread/conversation state remains in Claw. */
export async function handleFeishuInbound(
  channelId: string,
  message: NormalizedMessage,
  deps: FeishuInboundCoordinatorDeps
): Promise<void> {
    const bridge = deps.getBridge(channelId)
    const settings = await deps.loadSettings()
    const channel = settings.claw.channels.find((item) => item.id === channelId && item.enabled)
    if (!bridge || !channel) return
    if (bridge.botIdentity?.openId && message.senderId === bridge.botIdentity.openId) return
    if (message.chatType === 'group' && !message.mentionedBot && !message.mentionAll) return
    const remoteSession = buildFeishuRemoteSession(message)
    await deps.rememberRemoteSession(settings, channel, remoteSession)
    const conversation = findClawConversation(channel, {
      chatId: remoteSession.chatId,
      threadId: remoteSession.threadId
    })
    const workspaceRoot = deps.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession)
    const replyOptions = { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }

    // Feishu has no recipient until someone messages the bot, so the
    // one-time channel intro goes out before handling the first message.
    const welcomeText = deps.pendingWelcomeText(settings, channel)
    if (welcomeText) {
      deps.beginWelcome(channel.id)
      try {
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: welcomeText },
          {},
          {
            purpose: 'welcome',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
        await deps.markWelcomeSent(channel.id)
      } catch (error) {
        deps.logError('claw-feishu', 'Failed to send the Feishu welcome message; it will be retried on the next inbound message.', {
          message: errorMessage(error),
          channelId,
          chatId: message.chatId
        })
      } finally {
        deps.endWelcome(channel.id)
      }
    }

    const commandReply = await deps.handleCommand(settings, {
      text: message.content,
      channel,
      conversation,
      remoteSession
    })
    if (commandReply !== null) {
      await deps.sendMessage(
        bridge,
        message.chatId,
        { markdown: commandReply },
        replyOptions,
        {
          purpose: 'im-command',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }

    const sender = feishuSenderLabel(message)
    const modelResolution = deps.resolveModel(settings, channel, conversation)
    const taskCreation = await deps.createScheduledTaskFromText?.(message.content, {
      workspaceRoot: deps.resolveChannelWorkspaceRoot(settings, channel),
      clawChannelId: channel.id,
      providerId: modelResolution.providerId,
      modelHint: modelResolution.model,
      mode: settings.claw.im.mode
    }) ?? { kind: 'noop' as const }
    if (taskCreation.kind === 'created') {
      await deps.sendMessage(
        bridge,
        message.chatId,
        { markdown: taskCreation.confirmationText },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
        {
          purpose: 'schedule-created',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (taskCreation.kind === 'error') {
      await deps.sendMessage(
        bridge,
        message.chatId,
        { markdown: deps.formatError(settings, `Failed to create the scheduled task: ${taskCreation.message}`) },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
        {
          purpose: 'schedule-error',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (!message.content.trim() && message.rawContentType !== 'text') {
      try {
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: deps.formatError(settings, 'Only text messages are supported right now.') },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
          {
            purpose: 'unsupported-message',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch (error) {
        deps.logError('claw-feishu', 'Failed to send unsupported-message reply', {
          message: errorMessage(error),
          chatId: message.chatId
        })
      }
      return
    }

    if (shouldDirectSendExistingGeneratedFilesForPrompt(message.content)) {
      const existingThreadId = conversation?.localThreadId.trim() || channel.threadId.trim()
      const existingFiles = await deps.resolveGeneratedFiles(
        await deps.recentGeneratedFiles(settings, existingThreadId, workspaceRoot, {
          purpose: 'direct-existing-file-lookup',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }),
        workspaceRoot,
        {
          purpose: 'direct-existing-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }
      )
      if (existingFiles.length > 0) {
        try {
          await deps.sendMessage(
            bridge,
            message.chatId,
            { markdown: replyTextForGeneratedFiles('', existingFiles) },
            replyOptions,
            {
              purpose: 'direct-existing-file-reply',
              channelId,
              chatId: message.chatId,
              inboundMessageId: message.messageId,
              threadId: existingThreadId
            }
          )
        } catch (error) {
          deps.logError('claw-feishu', 'Failed to send direct file confirmation reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        }
        const delivery = await deps.sendGeneratedFiles(
          bridge,
          message.chatId,
          existingFiles,
          replyOptions,
          {
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        )
        if (delivery.sent.length > 0) return
        const failure = delivery.failed[0]?.message || 'unknown upload error'
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: `我找到了文件 ${existingFiles.map((file) => file.fileName).join(', ')}，但飞书附件上传失败：${failure}` },
          replyOptions,
          {
            purpose: 'direct-existing-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        ).catch((error) => {
          deps.logError('claw-feishu', 'Failed to send direct file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        })
        return
      }
    }

    // Add a "in progress" emoji reaction on the user's inbound message
    // immediately so they see feedback before the agent run completes
    // (which can take seconds). The reaction is targeted at the user's
    // message id (not a new bot message) and is left in place after the
    // agent finishes as a "handled" marker.
    //
    // Emoji type selection: Feishu / Lark's `im.v1.messageReaction.create`
    // endpoint accepts a closed set of `emoji_type` strings; the SDK does
    // NOT validate them locally — invalid values are rejected by the API
    // with `code 231001 "reaction type is invalid"`. Empirically verified:
    //   - `'WORK'`  → REJECTED (production logs, code 231001) — never use
    //   - `'OnIt'`  → CONFIRMED VALID — renders as 🫡 (salute face,
    //                 internet-canonical "got it, doing it" signal;
    //                 best match for the user-requested "在做了")
    //   - `'SMILE'` → CONFIRMED VALID — fallback, renders as 🙂
    //
    // Failure is logged but NOT re-thrown — we never want a reaction
    // failure to drop the user's message or abort the agent run.
    try {
      await bridge.addReaction(message.messageId, 'OnIt')
    } catch (error) {
      deps.logError('claw-feishu', 'Failed to add Feishu / Lark pending reaction; continuing with the agent run.', {
        message: errorMessage(error),
        chatId: message.chatId,
        messageId: message.messageId
      })
    }

    let result: ClawRunResult
    // Tracks whether the streaming path (or its in-band one-shot fallback)
    // already delivered a message to Feishu / Lark. When true, the post-
    // branch `sendFeishuMessage` below is skipped to avoid duplicating the
    // streamed text as a separate message bubble.
    let streamedToFeishu = false
    try {
      // feishuStream is now per-channel (default off). The runtime
      // default is the polling path; only switch to streaming when this
      // channel has explicitly enabled it.
      if (channel.feishuStream === true) {
        // Streaming path: start the turn (this also persists the
        // conversation via the onTurnStarted callback) and then stream
        // the assistant's reply into a Feishu / Lark markdown card.
        // The original `processIncomingImPrompt` polling path is kept
        // for users who explicitly disable streaming and for WeChat
        // (which has no markdown-stream card concept).
        const started = await deps.processPrompt(settings, {
          prompt: buildFeishuPrompt(message),
          sender,
          provider: 'feishu',
          channel,
          conversation,
          remoteSession,
          waitForResult: false
        })
        if (!started.ok || !started.threadId || !started.turnId) {
          result = { ok: false, message: started.message || 'Failed to start Feishu streaming turn.' }
        } else {
          const streamResult = await deps.runStreamingReply({
            bridge,
            chatId: message.chatId,
            threadId: started.threadId,
            turnId: started.turnId,
            replyOptions: { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
            responseTimeoutMs: 60_000,
            context: {
              purpose: 'feishu-stream',
              channelId,
              chatId: message.chatId,
              inboundMessageId: message.messageId,
              threadId: started.threadId,
              turnId: started.turnId
            }
          })
          if (streamResult.ok) {
            const streamedText = streamResult.finalText.trim() || 'Completed.'
            const streamFiles = await deps.recentGeneratedFiles(
              settings,
              started.threadId,
              workspaceRoot,
              {
                purpose: 'feishu-stream-file-lookup',
                channelId,
                chatId: message.chatId,
                inboundMessageId: message.messageId,
                threadId: started.threadId,
                turnId: started.turnId
              },
              started.turnId
            )
            // Either the streaming card (FeishuStreamer) or its one-shot
            // fallback already delivered the text to the chat. Mark
            // `streamedToFeishu` so the post-branch sendFeishuMessage
            // below is skipped.
            streamedToFeishu = true
            result = {
              ok: true,
              threadId: started.threadId,
              turnId: started.turnId,
              text: streamedText,
              message: streamResult.fellBack ? 'streamed (fell back to one-shot send)' : 'streamed',
              files: streamFiles,
              completed: true
            }
          } else {
            result = {
              ok: false,
              message: streamResult.message.trim() || 'Sorry, something went wrong while handling your message.'
            }
          }
        }
      } else {
        // Original polling path — unchanged.
        result = await deps.processPrompt(settings, {
          prompt: buildFeishuPrompt(message),
          sender,
          provider: 'feishu',
          channel,
          conversation,
          remoteSession
        })
      }
    } catch (error) {
      deps.logError('claw-feishu', 'Failed to handle Feishu inbound message', {
        message: errorMessage(error),
        chatId: message.chatId,
        senderId: message.senderId
      })
      try {
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: deps.formatError(settings, 'Sorry, I could not process your message right now.') },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
          {
            purpose: 'processing-error',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch {
        /* ignore secondary reply failures */
      }
      return
    }

    if (result.ok && result.completed === false) {
      // The turn outran the response window; the reply below is the ack
      // (carried on `result.message`). Deliver the real result when the
      // turn finishes.
      deps.scheduleResultPush(settings, {
        channel,
        remoteSession,
        threadId: result.threadId,
        turnId: result.turnId,
        workspaceRoot
      })
    }
    const generatedFiles = result.ok ? result.files ?? [] : []
    const filesToSend = result.ok && (generatedFiles.length > 0 || shouldSendGeneratedFilesForPrompt(message.content))
      ? await deps.resolveGeneratedFiles(generatedFiles, workspaceRoot, {
          purpose: 'agent-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: result.threadId,
          turnId: result.turnId
        })
      : []
    const replyText = result.ok
      ? replyTextForGeneratedFiles(result.text?.trim() || result.message?.trim() || 'Completed.', filesToSend)
      : deps.formatError(settings, result.message.trim() || 'Sorry, something went wrong while handling your message.')
    const resultThreadId = result.ok ? result.threadId : undefined
    const resultTurnId = result.ok ? result.turnId : undefined
    // The streaming path already delivered the text (either as a live
    // SDK card or via its one-shot fallback). Sending another one-shot
    // message here would duplicate the reply.
    if (!streamedToFeishu) {
      try {
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: replyText },
          replyOptions,
          {
            purpose: 'agent-reply',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            runtimeOk: result.ok,
            threadId: resultThreadId,
            turnId: resultTurnId
          }
        )
      } catch (error) {
        deps.logError('claw-feishu', 'Failed to send Feishu / Lark agent reply', {
          message: errorMessage(error),
          chatId: message.chatId,
          senderId: message.senderId,
          threadId: resultThreadId,
          turnId: resultTurnId
        })
      }
    }
    if (filesToSend.length > 0) {
      const delivery = await deps.sendGeneratedFiles(
        bridge,
        message.chatId,
        filesToSend,
        replyOptions,
        {
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: resultThreadId,
          turnId: resultTurnId
        }
      )
      if (delivery.sent.length === 0 && delivery.failed.length > 0) {
        await deps.sendMessage(
          bridge,
          message.chatId,
          { markdown: `我找到了文件 ${filesToSend.map((file) => file.fileName).join(', ')}，但飞书附件上传失败：${delivery.failed[0]?.message || 'unknown upload error'}` },
          replyOptions,
          {
            purpose: 'agent-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: resultThreadId,
            turnId: resultTurnId
          }
        ).catch((error) => {
          deps.logError('claw-feishu', 'Failed to send Feishu / Lark file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            senderId: message.senderId,
            threadId: resultThreadId,
            turnId: resultTurnId
          })
        })
      }
    }
}

function buildFeishuRemoteSession(message: NormalizedMessage): ClawImRemoteSessionV1 {
  return {
    chatId: message.chatId.trim(),
    messageId: message.messageId.trim(),
    threadId: message.threadId?.trim() || '',
    senderId: message.senderId.trim(),
    senderName: feishuSenderLabel(message),
    updatedAt: new Date().toISOString()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
