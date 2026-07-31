import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  Account,
  CancellationToken,
  ModelProviderRequest,
  ModelProviderStreamEvent
} from '@kun/extension-api'
import { DemoStreamingAdapter } from './extension.js'

const account: Account = {
  id: 'account-1',
  providerId: 'kun-examples.echo-api-key',
  label: 'Local test account',
  authenticationType: 'api-key',
  status: 'connected',
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const cancellation: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} })
}

function request(modelId = 'echo-1', requestId = 'request-1'): ModelProviderRequest {
  return {
    apiVersion: '1.0.0',
    requestId,
    binding: {
      providerId: account.providerId,
      accountId: account.id,
      modelId
    },
    instructions: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'stream this response' }] }],
    tools: [],
    generation: {}
  }
}

async function collect(stream: AsyncIterable<ModelProviderStreamEvent>): Promise<ModelProviderStreamEvent[]> {
  const events: ModelProviderStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

test('streams ordered text, usage, and one completed event headlessly', async () => {
  const adapter = new DemoStreamingAdapter({ listAccounts: async () => [account] })
  const events = await collect(adapter.stream(request(), { cancellation }))
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index))
  assert.equal(events.at(-2)?.type, 'usage')
  assert.equal(events.at(-1)?.type, 'completed')
  assert.match(
    events.filter((event) => event.type === 'textDelta').map((event) => event.delta).join(''),
    /stream this response/
  )
})

test('reports unknown models explicitly instead of falling back', async () => {
  const adapter = new DemoStreamingAdapter({ listAccounts: async () => [account] })
  const events = await collect(adapter.stream(request('missing-model'), { cancellation }))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'error')
  if (events[0]?.type === 'error') assert.equal(events[0].code, 'MODEL_NOT_FOUND')
})

test('honors explicit cancellation', async () => {
  const adapter = new DemoStreamingAdapter({ listAccounts: async () => [account] })
  adapter.cancel('cancelled-request')
  const events = await collect(adapter.stream(request('echo-1', 'cancelled-request'), { cancellation }))
  assert.equal(events[0]?.type, 'error')
  if (events[0]?.type === 'error') assert.equal(events[0].code, 'REQUEST_CANCELLED')
})
