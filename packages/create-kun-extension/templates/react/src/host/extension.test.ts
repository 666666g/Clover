import assert from 'node:assert/strict'
import test from 'node:test'
import { createExtensionTestHarness } from '@kun/extension-test'
import { activate } from './extension.js'

test('registers the refresh command', async () => {
  const harness = createExtensionTestHarness({ permissions: ['commands.register'] })
  await harness.activate(activate)
  assert.deepEqual(await harness.client.commands.executeCommand('refresh'), { accepted: true })
  assert.deepEqual(harness.webview.messages, [
    { channel: 'refresh', payload: { requested: true } }
  ])
  await harness.dispose()
})
