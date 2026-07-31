import assert from 'node:assert/strict'
import test from 'node:test'
import { createExtensionTestHarness } from '@kun/extension-test'
import { activate } from './extension.js'

test('registers the hello command', async () => {
  const harness = createExtensionTestHarness({ permissions: ['commands.register'] })
  await harness.activate(activate)
  assert.deepEqual(await harness.client.commands.executeCommand('hello'), {
    message: "{{HELLO_TITLE_JSON}}"
  })
  await harness.dispose()
})
