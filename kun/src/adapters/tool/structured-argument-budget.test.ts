import { describe, expect, it } from 'vitest'
import { validateStructuredArgumentBudget } from './structured-argument-budget.js'

describe('validateStructuredArgumentBudget', () => {
  const limits = { label: 'design_tool', maxBytes: 1_024, maxNodes: 5, maxDepth: 3 }

  it('reports byte, node, and depth budgets for reasonable JSON', () => {
    const result = validateStructuredArgumentBudget({ ops: [{ op: 'delete', id: 'shape-1' }] }, limits)
    expect(result).toMatchObject({ ok: true, budget: { nodes: 3, depth: 3 } })
  })

  it('rejects each structural budget with actionable guidance', () => {
    expect(validateStructuredArgumentBudget({ text: 'x'.repeat(2_000) }, limits)).toMatchObject({
      ok: false, error: expect.stringContaining('exceed 1024 bytes')
    })
    expect(validateStructuredArgumentBudget({ a: {}, b: {}, c: {}, d: {}, e: {} }, limits)).toMatchObject({
      ok: false, error: expect.stringContaining('exceed 5 structured nodes')
    })
    expect(validateStructuredArgumentBudget({ a: { b: { c: {} } } }, limits)).toMatchObject({
      ok: false, error: expect.stringContaining('nesting depth 3')
    })
  })
})
