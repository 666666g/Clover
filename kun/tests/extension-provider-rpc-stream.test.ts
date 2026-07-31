import { describe, expect, it } from 'vitest'
import { ExtensionHostClient } from '@kun/extension-api'
import {
  JsonRpcPeer,
  RpcHostTransport,
  type JsonValue,
  type RpcEnvelope
} from '../src/extensions/index.js'

describe('extension provider RPC streams', () => {
  it('uses ordered stream envelopes and acknowledgements instead of notifications', async () => {
    let parent!: JsonRpcPeer
    let child!: JsonRpcPeer
    let childTransport!: RpcHostTransport
    const notifications: string[] = []
    const streamItems: Array<{
      requestId: string
      sequence: number
      payload: JsonValue
      terminal: boolean
    }> = []

    parent = new JsonRpcPeer({
      send: (envelope) => deliver(child, envelope),
      onRequest: async (method) => {
        if (method === 'modelProviders.register') return { registrationId: 'provider-1' }
        if (method === 'modelProviders.unregister') return null
        throw new Error(`unexpected parent request: ${method}`)
      },
      onNotification: (method) => {
        notifications.push(method)
      },
      onStream: async (requestId, sequence, payload, terminal) => {
        streamItems.push({ requestId, sequence, payload, terminal })
      }
    })
    child = new JsonRpcPeer({
      send: (envelope) => deliver(parent, envelope),
      onRequest: async (method, params, context) => {
        const result = await childTransport.invoke(method, params, {
          requestId: context.id,
          signal: context.signal
        })
        if (result === undefined) throw new Error(`unexpected child request: ${method}`)
        return result
      }
    })
    childTransport = new RpcHostTransport(child)
    const client = new ExtensionHostClient(childTransport)
    const registration = await client.modelProviders.registerProvider({
      id: 'echo',
      displayName: 'Echo',
      models: []
    }, {
      async probe() { return { ok: true } },
      async listModels() { return [] },
      async *stream(request) {
        yield { requestId: request.requestId, sequence: 0, type: 'textDelta', delta: 'hello' }
        yield {
          requestId: request.requestId,
          sequence: 1,
          type: 'completed',
          finishReason: 'stop'
        }
      },
      async cancel() {}
    })

    await expect(parent.request('modelProviders.invoke:provider-1', {
      operation: 'stream',
      request: {
        apiVersion: '1.0.0',
        requestId: 'model_request_1',
        binding: { providerId: 'echo', accountId: 'account-1', modelId: 'echo-1' },
        instructions: [],
        messages: [],
        tools: [],
        generation: {}
      }
    })).resolves.toEqual({ accepted: true })

    expect(notifications).not.toContain('modelProviders.streamEvent')
    expect(streamItems).toHaveLength(2)
    expect(streamItems.map((item) => item.sequence)).toEqual([1, 2])
    expect(streamItems.map((item) => item.terminal)).toEqual([false, true])
    expect(new Set(streamItems.map((item) => item.requestId)).size).toBe(1)
    expect(streamItems.map((item) => (item.payload as { kind: string }).kind)).toEqual([
      'event',
      'event'
    ])

    await registration.dispose()
    await client.dispose()
    parent.close()
    child.close()
  })

  it('acknowledges but does not project stream items emitted after cancellation', async () => {
    let parent!: JsonRpcPeer
    let child!: JsonRpcPeer
    let projected = 0
    let releaseLateStream!: () => void
    const lateStream = new Promise<void>((resolve) => {
      releaseLateStream = resolve
    })

    parent = new JsonRpcPeer({
      send: (envelope) => deliver(child, envelope),
      onStream: () => {
        projected += 1
      }
    })
    child = new JsonRpcPeer({
      send: (envelope) => deliver(parent, envelope),
      onRequest: async (_method, _params, context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => {
            void child.sendStream(context.id, { late: true }, true).finally(() => {
              releaseLateStream()
              resolve()
            })
          }, { once: true })
        })
        return null
      }
    })

    const controller = new AbortController()
    const request = parent.request('stream-until-cancelled', null, { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'EXTENSION_HOST_CANCELLED' })
    await lateStream
    expect(projected).toBe(0)

    parent.close()
    child.close()
  })

  it('uses stream activity as an idle-timeout heartbeat instead of a total request deadline', async () => {
    let parent!: JsonRpcPeer
    let child!: JsonRpcPeer
    const projected: number[] = []
    parent = new JsonRpcPeer({
      send: (envelope) => deliver(child, envelope),
      onStream: (_requestId, sequence) => { projected.push(sequence) }
    })
    child = new JsonRpcPeer({
      send: (envelope) => deliver(parent, envelope),
      onRequest: async (_method, _params, context) => {
        await delay(60)
        await child.sendStream(context.id, { value: 1 })
        await delay(60)
        await child.sendStream(context.id, { value: 2 }, true)
        await delay(60)
        return { accepted: true }
      }
    })

    await expect(parent.request('long-active-stream', null, {
      timeoutMs: 100,
      resetTimeoutOnStream: true
    })).resolves.toEqual({ accepted: true })
    expect(projected).toEqual([1, 2])

    parent.close()
    child.close()
  })
})

async function deliver(peer: JsonRpcPeer, envelope: RpcEnvelope): Promise<void> {
  await peer.receive(structuredClone(envelope))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
