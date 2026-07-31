import { describe, expect, it } from 'vitest'
import { evaluateWhenExpression, validateWhenExpression } from './when-expression'

describe('closed contribution when expressions', () => {
  it('evaluates public context keys without executing JavaScript', () => {
    const context = {
      workspaceOpen: true,
      'workbench.mode': 'code',
      selectionCount: 2
    }
    expect(evaluateWhenExpression("workspaceOpen && workbench.mode == 'code'", context)).toBe(true)
    expect(evaluateWhenExpression('!workspaceOpen || selectionCount == 3', context)).toBe(false)
  })

  it('fails closed for unknown keys and executable syntax', () => {
    expect(evaluateWhenExpression('missingCapability', {})).toBe(false)
    expect(evaluateWhenExpression('globalThis.alert(1)', { globalThis: true })).toBe(false)
    expect(validateWhenExpression('workspaceOpen && (() => true)()')).not.toBeNull()
  })
})
