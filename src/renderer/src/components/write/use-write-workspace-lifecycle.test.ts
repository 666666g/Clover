import { describe, expect, it } from 'vitest'
import {
  canApplyPendingWriteAgentReviewDirectly,
  pendingWriteAgentReviewMatches
} from './use-write-workspace-lifecycle'

describe('write workspace lifecycle guards', () => {
  const review = {
    workspaceRoot: '/workspace',
    filePath: '/workspace/a.md',
    documentEpoch: 3,
    nextContent: 'agent content'
  }

  it('accepts a review only for its originating active document', () => {
    expect(pendingWriteAgentReviewMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 3
    }, review)).toBe(true)
  })

  it('rejects a review after a file switch or same-path reopen', () => {
    expect(pendingWriteAgentReviewMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/b.md',
      documentEpoch: 4
    }, review)).toBe(false)
    expect(pendingWriteAgentReviewMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 4
    }, review)).toBe(false)
  })

  it('does not directly apply an external review over a dirty or failed local draft', () => {
    expect(canApplyPendingWriteAgentReviewDirectly({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 3,
      saveStatus: 'dirty'
    }, review)).toBe(false)
    expect(canApplyPendingWriteAgentReviewDirectly({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 3,
      saveStatus: 'error'
    }, review)).toBe(false)
    expect(canApplyPendingWriteAgentReviewDirectly({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 3,
      saveStatus: 'saved'
    }, review)).toBe(true)
  })
})
