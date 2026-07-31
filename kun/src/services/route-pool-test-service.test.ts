import { describe, expect, it, vi } from 'vitest'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { ModelRoutePoolConfig } from '../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from '../adapters/model/route-pool-model-client.js'
import { RoutePoolTestService } from './route-pool-test-service.js'

const routePool: ModelRoutePoolConfig = {
  id: 'pool',
  name: 'Pool',
  modelId: 'kimi-k3',
  enabled: true,
  strategy: 'priority',
  targets: [
    { id: 'primary', providerId: 'provider-a', modelId: 'kimi-k3', enabled: true, weight: 1 },
    { id: 'backup', providerId: 'provider-b', modelId: 'kimi-k3', enabled: true, weight: 1 }
  ],
  failurePolicy: {
    failoverHttpStatusCodes: [429, 503],
    failoverOnNetworkError: true,
    failoverOnTimeout: true,
    failoverOnAuthError: true
  },
  healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
}

class DelayedDirectClient implements ModelClient {
  provider = 'test'
  model = 'kimi-k3'
  releaseBackup?: () => void

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.providerId === 'provider-a') {
      yield {
        kind: 'error',
        message: 'rate limited',
        code: 'rate_limited',
        failure: { category: 'rate_limit', httpStatus: 429, failoverAllowed: true }
      }
      return
    }
    await new Promise<void>((resolve) => { this.releaseBackup = resolve })
    yield { kind: 'assistant_text_delta', text: 'OK' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('RoutePoolTestService', () => {
  it('runs independently, exposes target progress, deduplicates active starts, and retains results', async () => {
    const direct = new DelayedDirectClient()
    const health = new RoutePoolHealthStore()
    const capability = (model: string): ModelCapabilityMetadata => ({
      id: model,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    })
    const routed = new RoutePoolModelClient(direct, [routePool], capability, health)
    const service = new RoutePoolTestService(routed, () => routed.routePools(), health, Date.now, () => 'test-1')

    const queued = service.start(routePool.id)
    expect(queued).toMatchObject({ id: 'test-1', status: 'queued', totalTargets: 2 })

    await vi.waitFor(() => {
      expect(service.list(routePool.id)[0]).toMatchObject({
        status: 'running',
        attemptedTargets: 2,
        attempts: [
          expect.objectContaining({ targetId: 'primary', status: 'failed', category: 'rate_limit' }),
          expect.objectContaining({ targetId: 'backup', status: 'running' })
        ],
        currentTarget: expect.objectContaining({ targetId: 'backup' })
      })
    })

    expect(service.start(routePool.id)?.id).toBe('test-1')
    direct.releaseBackup?.()

    await vi.waitFor(() => {
      expect(service.list(routePool.id)[0]).toMatchObject({
        status: 'succeeded',
        attemptedTargets: 2,
        output: 'OK',
        selectedTarget: expect.objectContaining({ targetId: 'backup' })
      })
    })

    expect(service.list(routePool.id)[0].attempts).toEqual([
      expect.objectContaining({ targetId: 'primary', status: 'failed' }),
      expect.objectContaining({ targetId: 'backup', status: 'succeeded' })
    ])
  })
})
