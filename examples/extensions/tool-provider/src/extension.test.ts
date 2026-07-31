import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeEntries, workspaceSummaryTool } from './extension.js'

test('workspace summary is deterministic and bounded', () => {
  const entries = Array.from({ length: 105 }, (_, index) => ({ name: `file-${index}` }))
  const summary = summarizeEntries('.', entries)
  assert.equal(summary.entryCount, 105)
  assert.equal(Array.isArray(summary.entries) ? summary.entries.length : 0, 100)
  assert.equal(workspaceSummaryTool.sideEffects, 'read')
  assert.equal(workspaceSummaryTool.idempotent, true)
})
