import assert from 'node:assert/strict'
import test from 'node:test'
import { increment } from './state.js'

test('increments immutable state', () => {
  assert.deepEqual(increment({ count: 1 }), { count: 2 })
})
