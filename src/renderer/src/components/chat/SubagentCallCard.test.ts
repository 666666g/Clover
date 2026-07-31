import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { parseDelegateDetail, SubagentCallCard, SubagentGroup } from './SubagentCallCard'

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    subagentAgentLabel: 'Agent',
    subagentModelLabel: 'Model',
    subagentNotRecorded: 'Not recorded',
    subagentDefaultName: 'Subagent',
    subagentStatusQueued: 'Queued',
    subagentStatusRunning: 'Running',
    subagentStatusDone: 'Done',
    subagentStatusFailed: 'Failed',
    subagentStatusAwaiting: 'Awaiting approval',
    subagentOpenSession: 'Open sub-session',
    subagentGeneratedBadge: 'Generated'
  }
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({
      t: (key: string, fallback?: string | { defaultValue?: string }) =>
        labels[key] ?? (typeof fallback === 'string' ? fallback : fallback?.defaultValue) ?? key
    })
  }
})

describe('parseDelegateDetail', () => {
  it('reads the generated role name from the direct generated-agent result', () => {
    expect(parseDelegateDetail(JSON.stringify({
      profile: 'generated:ipc-investigator:12345678',
      profileName: 'IPC Investigator',
      model: 'gpt-5.6-sol',
      generatedAgent: { name: 'IPC Investigator' }
    }))).toMatchObject({
      generated: true,
      generatedAgentName: 'IPC Investigator',
      profileName: 'IPC Investigator',
      model: 'gpt-5.6-sol'
    })
  })

  it('falls back to the generated role snapshot embedded in routing metadata', () => {
    expect(parseDelegateDetail(JSON.stringify({
      profile: 'generated:browser-qa:12345678',
      routing: {
        selectedKind: 'generated',
        agent: { name: 'Browser QA Specialist' }
      }
    }))).toMatchObject({
      generated: true,
      generatedAgentName: 'Browser QA Specialist'
    })
  })
})

describe('SubagentCallCard route metadata', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
  })

  it('keeps the task title separate from the recorded built-in agent and model', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, {
        block: childBlock({
          childLabel: 'Greeting Agent 1',
          childProfile: 'general',
          childProfileName: 'General Agent',
          childModel: 'gpt-5.6-sol'
        }, {
          summary: 'Hello! How can I help?',
          model: 'older-result-model'
        })
      }))
    })

    const metadata = renderer!.root.findByProps({ 'data-testid': 'subagent-route-metadata' })
    expect(metadata.props['data-agent-id']).toBe('general')
    expect(metadata.props['data-model']).toBe('gpt-5.6-sol')
    expect(instanceText(metadata)).toContain('General Agent (general)')
    expect(instanceText(renderer!.root)).toContain('Greeting Agent 1')
    expect(instanceText(renderer!.root)).toContain('Hello! How can I help?')
  })

  it('renders generated identity and model from a replayed tool result', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, {
        block: childBlock(undefined, {
          profile: 'generated:ipc-investigator:12345678',
          profileName: 'IPC Investigator',
          model: 'gpt-5.6-terra',
          summary: 'IPC path verified.'
        })
      }))
    })

    const metadata = renderer!.root.findByProps({ 'data-testid': 'subagent-route-metadata' })
    expect(metadata.props['data-agent-id']).toBe('generated:ipc-investigator:12345678')
    expect(metadata.props['data-model']).toBe('gpt-5.6-terra')
    expect(instanceText(metadata)).toContain('IPC Investigator (generated:ipc-investigator:12345678)')
  })

  it('labels missing legacy identity and model instead of inferring current settings', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, {
        block: childBlock(undefined, { summary: 'Legacy result.' })
      }))
    })

    const metadata = renderer!.root.findByProps({ 'data-testid': 'subagent-route-metadata' })
    expect(metadata.props['data-agent-id']).toBe('')
    expect(metadata.props['data-model']).toBe('Not recorded')
    expect(instanceText(metadata).match(/Not recorded/g)).toHaveLength(2)
  })

  it('shows independently comparable route metadata for every grouped child row', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentGroup, {
        blocks: [
          childBlock({
            childId: 'child_general',
            childLabel: 'Greeting Agent 1',
            childProfile: 'general',
            childProfileName: 'General Agent',
            childModel: 'gpt-5.6-sol',
            childSeq: 1
          }, { summary: 'Hello.' }, 'tool_general'),
          childBlock({
            childId: 'child_explore',
            childLabel: 'Greeting Agent 2',
            childProfile: 'explore',
            childProfileName: 'Repository Explorer',
            childModel: 'gpt-5.6-terra',
            childSeq: 2
          }, { summary: 'Hi.' }, 'tool_explore')
        ]
      }))
    })

    const rows = renderer!.root.findAllByProps({ 'data-testid': 'subagent-route-metadata' })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.props['data-agent-id'])).toEqual(['general', 'explore'])
    expect(rows.map((row) => row.props['data-model'])).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra'])
  })
})

function childBlock(
  child: Record<string, unknown> | undefined,
  detail: Record<string, unknown>,
  id = 'tool_delegate'
): ToolBlock {
  const childId = typeof child?.childId === 'string' ? child.childId : `child_${id}`
  return {
    kind: 'tool',
    id,
    createdAt: '2026-07-22T00:00:00.000Z',
    summary: typeof child?.childLabel === 'string' ? child.childLabel : 'Greeting Agent',
    status: 'success',
    toolKind: 'tool_call',
    detail: JSON.stringify({
      childId,
      status: 'completed',
      durationMs: 1_000,
      ...detail
    }),
    meta: {
      toolName: 'delegate_task',
      ...(child ? {
        child: {
          parentThreadId: 'thread_parent',
          parentTurnId: 'turn_parent',
          childId,
          childStatus: 'completed',
          childSeq: 1,
          ...child
        }
      } : {})
    }
  }
}

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => typeof child === 'string' ? child : instanceText(child))
    .join('')
}
