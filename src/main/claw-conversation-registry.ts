import type {
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1
} from '../shared/app-settings'
import { clawConversationKey } from './claw-runtime-helpers'

export type ClawConversationSession = Pick<
  ClawImRemoteSessionV1,
  'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'
>

export function findClawConversation(
  channel: ClawImChannelV1,
  session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
): ClawImConversationV1 | undefined {
  const targetKey = clawConversationKey(session.chatId, session.threadId)
  return channel.conversations.find((conversation) =>
    clawConversationKey(conversation.chatId, conversation.remoteThreadId) === targetKey
  )
}

export function currentClawThreadId(input: {
  channel?: ClawImChannelV1
  conversation?: ClawImConversationV1
  remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
}): string {
  const { channel, conversation, remoteSession } = input
  const legacyChannelThreadId = remoteSession && !conversation && (channel?.conversations.length ?? 0) === 0
    ? channel?.threadId.trim()
    : ''
  return conversation?.localThreadId.trim() ||
    legacyChannelThreadId ||
    (remoteSession ? '' : channel?.threadId.trim()) ||
    ''
}

export function resolveClawConversation(
  channel: ClawImChannelV1,
  input: {
    conversationId?: string
    remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  }
): ClawImConversationV1 | undefined {
  if (input.remoteSession) return findClawConversation(channel, input.remoteSession)
  const conversationId = input.conversationId?.trim()
  return conversationId
    ? channel.conversations.find((conversation) => conversation.id === conversationId)
    : undefined
}

export function clearClawThreadBinding(input: {
  channel: ClawImChannelV1
  conversation?: ClawImConversationV1
  remoteSession?: ClawConversationSession
  now: string
}): ClawImChannelV1 {
  const currentConversation = resolveClawConversation(input.channel, {
    conversationId: input.conversation?.id,
    remoteSession: input.remoteSession
  })
  return {
    ...input.channel,
    threadId: '',
    conversations: currentConversation
      ? input.channel.conversations.map((conversation) =>
          conversation.id === currentConversation.id
            ? {
                ...conversation,
                latestMessageId: input.remoteSession?.messageId || conversation.latestMessageId,
                senderId: input.remoteSession?.senderId || conversation.senderId,
                senderName: input.remoteSession?.senderName || conversation.senderName,
                localThreadId: '',
                updatedAt: input.now
              }
            : conversation
        )
      : input.channel.conversations,
    updatedAt: input.now
  }
}

export function bindClawConversationToThread(input: {
  channel: ClawImChannelV1
  conversation?: ClawImConversationV1
  remoteSession?: ClawConversationSession
  threadId: string
  workspaceRoot: string
  providerId: string
  model: string
  now: string
  createId: () => string
}): ClawImChannelV1 {
  const currentConversation = resolveClawConversation(input.channel, {
    conversationId: input.conversation?.id,
    remoteSession: input.remoteSession
  })
  let conversations = input.channel.conversations
  if (input.remoteSession) {
    const nextConversation: ClawImConversationV1 = currentConversation
      ? {
          ...currentConversation,
          latestMessageId: input.remoteSession.messageId || currentConversation.latestMessageId,
          senderId: input.remoteSession.senderId || currentConversation.senderId,
          senderName: input.remoteSession.senderName || currentConversation.senderName,
          localThreadId: input.threadId,
          workspaceRoot: input.workspaceRoot || currentConversation.workspaceRoot,
          providerId: currentConversation.providerId?.trim() || input.providerId,
          model: currentConversation.model?.trim() || input.model,
          updatedAt: input.now
        }
      : {
          id: input.createId(),
          chatId: input.remoteSession.chatId,
          remoteThreadId: input.remoteSession.threadId,
          latestMessageId: input.remoteSession.messageId,
          senderId: input.remoteSession.senderId,
          senderName: input.remoteSession.senderName,
          localThreadId: input.threadId,
          workspaceRoot: input.workspaceRoot,
          providerId: input.providerId,
          model: input.model,
          createdAt: input.now,
          updatedAt: input.now
        }
    conversations = currentConversation
      ? conversations.map((entry) => entry.id === currentConversation.id ? nextConversation : entry)
      : [...conversations, nextConversation]
  } else if (currentConversation) {
    conversations = conversations.map((entry) =>
      entry.id === currentConversation.id
        ? { ...entry, localThreadId: input.threadId, updatedAt: input.now }
        : entry
    )
  }
  return {
    ...input.channel,
    threadId: input.threadId,
    conversations,
    updatedAt: input.now
  }
}

export function setClawConversationModelSelection(input: {
  channel: ClawImChannelV1
  conversation?: ClawImConversationV1
  remoteSession?: ClawConversationSession
  providerId: string
  model: string
  workspaceRoot: string
  now: string
  createId: () => string
}): ClawImChannelV1 {
  const currentConversation = resolveClawConversation(input.channel, {
    conversationId: input.conversation?.id,
    remoteSession: input.remoteSession
  })
  const nextConversation: ClawImConversationV1 | null = input.remoteSession
    ? currentConversation
      ? {
          ...currentConversation,
          latestMessageId: input.remoteSession.messageId || currentConversation.latestMessageId,
          senderId: input.remoteSession.senderId || currentConversation.senderId,
          senderName: input.remoteSession.senderName || currentConversation.senderName,
          providerId: input.providerId,
          model: input.model,
          updatedAt: input.now
        }
      : {
          id: input.createId(),
          chatId: input.remoteSession.chatId,
          remoteThreadId: input.remoteSession.threadId,
          latestMessageId: input.remoteSession.messageId,
          senderId: input.remoteSession.senderId,
          senderName: input.remoteSession.senderName,
          localThreadId: '',
          workspaceRoot: input.workspaceRoot,
          providerId: input.providerId,
          model: input.model,
          createdAt: input.now,
          updatedAt: input.now
        }
    : null
  return {
    ...input.channel,
    providerId: input.remoteSession ? input.channel.providerId : input.providerId,
    model: input.remoteSession ? input.channel.model : input.model,
    conversations: currentConversation && nextConversation
      ? input.channel.conversations.map((entry) =>
          entry.id === currentConversation.id ? nextConversation : entry
        )
      : nextConversation
        ? [...input.channel.conversations, nextConversation]
        : input.channel.conversations,
    updatedAt: input.now
  }
}
