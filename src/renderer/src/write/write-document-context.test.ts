import { describe, expect, it } from 'vitest'
import {
  captureWriteDocumentContext,
  nextWriteDocumentEpoch,
  writeDocumentContextMatches
} from './write-document-context'

describe('write document context', () => {
  it('normalizes workspace and file paths when capturing a context', () => {
    expect(captureWriteDocumentContext({
      workspaceRoot: 'C:\\work\\drafts\\',
      activeFilePath: 'C:\\work\\drafts\\note.md',
      documentEpoch: 7
    })).toEqual({
      workspaceRoot: 'C:/work/drafts',
      filePath: 'C:/work/drafts/note.md',
      documentEpoch: 7
    })
  })

  it('rejects a stale operation after leaving and reopening the same path', () => {
    const operation = {
      workspaceRoot: '/workspace',
      filePath: '/workspace/note.md',
      documentEpoch: 4
    }

    expect(writeDocumentContextMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/note.md',
      documentEpoch: 5
    }, operation)).toBe(false)
  })

  it('rejects a stale rich rewrite after the same path is reopened', () => {
    const rewrite = captureWriteDocumentContext({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/note.md',
      documentEpoch: 9
    })

    expect(rewrite).not.toBeNull()
    expect(writeDocumentContextMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/note.md',
      documentEpoch: 10
    }, rewrite!)).toBe(false)
  })

  it('rejects a stale clipboard-image completion after a file switch', () => {
    const paste = captureWriteDocumentContext({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/a.md',
      documentEpoch: 2
    })

    expect(paste).not.toBeNull()
    expect(writeDocumentContextMatches({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/b.md',
      documentEpoch: 3
    }, paste!)).toBe(false)
  })

  it('advances invalid and valid epochs monotonically', () => {
    expect(nextWriteDocumentEpoch(4)).toBe(5)
    expect(nextWriteDocumentEpoch(Number.NaN)).toBe(1)
  })
})
