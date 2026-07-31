import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import type { ThreadService } from '../../services/thread-service.js'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'

describe('model request trace route', () => {
  it('requires runtime authentication and returns only the selected existing thread', async () => {
    const recorder = new LlmDebugRecorder()
    await capture(recorder, 'thread-1', 'one')
    await capture(recorder, 'thread-2', 'two')
    const router = buildRouter(runtime(recorder))

    const unauthorized = await dispatch(router, '/v1/threads/thread-1/model-requests')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.body).not.toContain('one')

    const response = await dispatch(
      router,
      '/v1/threads/thread-1/model-requests?limit=20',
      { authorization: 'Bearer trace-token' }
    )
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { records: Array<{ threadId: string; request: { body: { text: string } } }> }
    expect(body.records).toHaveLength(1)
    expect(body.records[0].threadId).toBe('thread-1')
    expect(body.records[0].request.body.text).toBe('{"prompt":"one"}')
    expect(response.body).not.toContain('two')
  })

  it('returns not found before consulting trace storage and validates page limits', async () => {
    const router = buildRouter(runtime(new LlmDebugRecorder()))
    const headers = { authorization: 'Bearer trace-token' }

    expect((await dispatch(router, '/v1/threads/missing/model-requests', headers)).status).toBe(404)
    expect((await dispatch(router, '/v1/threads/thread-1/model-requests?limit=9999', headers)).status).toBe(400)
  })
})

async function capture(recorder: LlmDebugRecorder, threadId: string, prompt: string): Promise<void> {
  const round = recorder.start({ threadId, turnId: 'turn-1', provider: 'test', model: 'model' })
  const record = recorder.beginHttpAttempt(round, {
    endpointFormat: 'chat_completions',
    attempt: 1,
    reason: 'initial',
    url: 'https://provider.example/v1/chat/completions',
    headers: { Authorization: 'Bearer secret' },
    bodyText: JSON.stringify({ prompt }),
    secretValues: ['secret']
  })
  recorder.captureHttpResponse(round, record, new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }))
  await recorder.finish(round)
}

function runtime(recorder: LlmDebugRecorder): ServerRuntime {
  const thread = createThreadRecord({
    id: 'thread-1', title: 'Trace', workspace: '/tmp', model: 'model', status: 'idle'
  })
  const other = createThreadRecord({
    id: 'thread-2', title: 'Other', workspace: '/tmp', model: 'model', status: 'idle'
  })
  return {
    runtimeToken: 'trace-token',
    insecure: false,
    llmDebug: recorder,
    threadService: {
      get: async (id: string) => id === thread.id ? thread : id === other.id ? other : null
    } as unknown as ThreadService
  } as unknown as ServerRuntime
}

async function dispatch(
  router: ReturnType<typeof buildRouter>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  const request = new Request(`http://127.0.0.1${path}`, { method: 'GET', headers })
  const match = router.match('GET', new URL(request.url).pathname)
  if (!match) throw new Error(`route not found: ${path}`)
  const result = await match.handler(request, { params: match.params })
  return result instanceof Response
    ? { status: result.status, body: await result.text() }
    : { status: result.status, body: result.body }
}
