import { describe, expect, it } from 'vitest'
import type { ClawImChannelV1, ClawImConversationV1 } from '../shared/app-settings'
import {
  bindClawConversationToThread,
  clearClawThreadBinding,
  currentClawThreadId,
  findClawConversation,
  setClawConversationModelSelection
} from './claw-conversation-registry'

const NOW = '2026-07-11T00:00:00.000Z'

function conversation(overrides: Partial<ClawImConversationV1> = {}): ClawImConversationV1 {
  return {
    id: 'conv_1',
    chatId: 'chat_1',
    remoteThreadId: 'remote_1',
    latestMessageId: 'message_1',
    senderId: 'sender_1',
    senderName: 'Alice',
    localThreadId: 'thread_old',
    workspaceRoot: '/workspace/conversations/remote_1',
    providerId: 'provider_existing',
    model: 'model_existing',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides
  }
}

function channel(conversations: ClawImConversationV1[] = []): ClawImChannelV1 {
  return {
    id: 'channel_1',
    provider: 'feishu',
    label: 'Feishu',
    enabled: true,
    model: 'auto',
    threadId: 'legacy_thread',
    workspaceRoot: '/workspace',
    agentProfile: {
      name: 'kun', description: '', identity: '', personality: '', userContext: '', replyRules: ''
    },
    conversations,
    welcomeSentAt: '',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  }
}

const session = {
  chatId: 'chat_1',
  threadId: 'remote_1',
  messageId: 'message_2',
  senderId: 'sender_1',
  senderName: 'Alice Updated'
}

describe('Claw conversation registry', () => {
  it('reuses a conversation by channel-independent chat/thread identity', () => {
    const existing = conversation()
    expect(findClawConversation(channel([existing]), session)).toBe(existing)
    expect(currentClawThreadId({ channel: channel([existing]), conversation: existing, remoteSession: session }))
      .toBe('thread_old')
  })

  it('preserves the legacy channel thread only before conversation backfill', () => {
    expect(currentClawThreadId({ channel: channel(), remoteSession: session })).toBe('legacy_thread')
    expect(currentClawThreadId({ channel: channel([conversation()]), remoteSession: session })).toBe('')
  })

  it('binds an existing conversation without replacing its provider/model selection', () => {
    const next = bindClawConversationToThread({
      channel: channel([conversation()]),
      remoteSession: session,
      threadId: 'thread_new',
      workspaceRoot: '/workspace/conversations/remote_1',
      providerId: 'provider_default',
      model: 'model_default',
      now: NOW,
      createId: () => 'unused'
    })
    expect(next.threadId).toBe('thread_new')
    expect(next.conversations).toHaveLength(1)
    expect(next.conversations[0]).toMatchObject({
      id: 'conv_1',
      localThreadId: 'thread_new',
      latestMessageId: 'message_2',
      senderName: 'Alice Updated',
      providerId: 'provider_existing',
      model: 'model_existing',
      updatedAt: NOW
    })
  })

  it('binds a directly selected conversation when no remote session accompanies a command', () => {
    const existing = conversation()
    const next = bindClawConversationToThread({
      channel: channel([existing]),
      conversation: existing,
      threadId: 'thread_selected',
      workspaceRoot: '',
      providerId: 'provider_default',
      model: 'model_default',
      now: NOW,
      createId: () => 'unused'
    })
    expect(next.threadId).toBe('thread_selected')
    expect(next.conversations[0]).toMatchObject({
      id: existing.id,
      localThreadId: 'thread_selected',
      providerId: 'provider_existing',
      model: 'model_existing',
      updatedAt: NOW
    })
  })

  it('creates and clears one binding without mutating another conversation', () => {
    const other = conversation({ id: 'conv_other', chatId: 'chat_other', remoteThreadId: '' })
    const bound = bindClawConversationToThread({
      channel: channel([other]),
      remoteSession: session,
      threadId: 'thread_new',
      workspaceRoot: '/workspace/conversations/remote_1',
      providerId: 'provider_default',
      model: 'model_default',
      now: NOW,
      createId: () => 'conv_new'
    })
    expect(bound.conversations).toHaveLength(2)
    expect(bound.conversations[0]).toBe(other)
    expect(bound.conversations[1]).toMatchObject({ id: 'conv_new', localThreadId: 'thread_new' })

    const cleared = clearClawThreadBinding({ channel: bound, remoteSession: session, now: NOW })
    expect(cleared.threadId).toBe('')
    expect(cleared.conversations[0]).toBe(other)
    expect(cleared.conversations[1].localThreadId).toBe('')
  })

  it('stores a per-conversation model without changing channel defaults', () => {
    const next = setClawConversationModelSelection({
      channel: channel(),
      remoteSession: session,
      providerId: 'provider_selected',
      model: 'model_selected',
      workspaceRoot: '/workspace/conversations/remote_1',
      now: NOW,
      createId: () => 'conv_selected'
    })
    expect(next.model).toBe('auto')
    expect(next.providerId).toBeUndefined()
    expect(next.conversations[0]).toMatchObject({
      id: 'conv_selected',
      providerId: 'provider_selected',
      model: 'model_selected',
      localThreadId: ''
    })
  })
})
