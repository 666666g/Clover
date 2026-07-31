import { randomUUID } from 'node:crypto'
import type { ModelRouteEvent, RoutePoolHealthStore } from '../adapters/model/route-pool-model-client.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID, type ModelRoutePoolConfig } from '../contracts/model-route-pool.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelRequest, ModelRouteTargetMetadata, ModelStreamChunk } from '../ports/model-client.js'

export type RoutePoolTestStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type RoutePoolTestAttemptStatus = 'running' | 'succeeded' | 'failed'

export type RoutePoolTestAttempt = {
  index: number
  targetId: string
  providerId: string
  modelId: string
  status: RoutePoolTestAttemptStatus
  startedAt: string
  completedAt?: string
  latencyMs?: number
  category?: string
  message?: string
}

export type RoutePoolTestRecord = {
  id: string
  poolId: string
  modelId: string
  status: RoutePoolTestStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  totalTargets: number
  attemptedTargets: number
  attempts: RoutePoolTestAttempt[]
  currentTarget?: Pick<ModelRouteTargetMetadata, 'targetId' | 'providerId' | 'modelId'>
  selectedTarget?: Pick<ModelRouteTargetMetadata, 'targetId' | 'providerId' | 'modelId'>
  output?: string
  error?: { message: string; code?: string; category?: string }
}

type MutableRoutePoolTestRecord = Omit<RoutePoolTestRecord, 'attempts' | 'attemptedTargets' | 'currentTarget'> & {
  attempts?: RoutePoolTestAttempt[]
}

const MAX_ROUTE_TESTS = 30
const MAX_TEST_OUTPUT_CHARS = 2_000
const MAX_TEST_ERROR_CHARS = 1_000

export class RoutePoolTestService {
  private readonly tests: MutableRoutePoolTestRecord[] = []

  constructor(
    private readonly modelClient: ModelClient,
    private readonly pools: () => ModelRoutePoolConfig[],
    private readonly health: RoutePoolHealthStore,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID
  ) {}

  start(poolId: string): RoutePoolTestRecord | null {
    const pool = this.pools().find((candidate) => candidate.id === poolId && candidate.enabled)
    if (!pool) return null
    const active = this.tests.find((test) => test.poolId === poolId && isActive(test.status))
    if (active) return this.snapshot(active)

    const createdAt = this.isoNow()
    const test: MutableRoutePoolTestRecord = {
      id: this.createId(),
      poolId: pool.id,
      modelId: pool.modelId,
      status: 'queued',
      createdAt,
      totalTargets: pool.targets.filter((target) => target.enabled).length
    }
    this.tests.unshift(test)
    if (this.tests.length > MAX_ROUTE_TESTS) this.tests.splice(MAX_ROUTE_TESTS)
    queueMicrotask(() => { void this.run(test) })
    return this.snapshot(test)
  }

  list(poolId?: string): RoutePoolTestRecord[] {
    return this.tests
      .filter((test) => !poolId || test.poolId === poolId)
      .map((test) => this.snapshot(test))
  }

  private async run(test: MutableRoutePoolTestRecord): Promise<void> {
    test.status = 'running'
    test.startedAt = this.isoNow()
    const controller = new AbortController()
    let output = ''
    try {
      for await (const chunk of this.modelClient.stream(this.request(test, controller.signal))) {
        if (chunk.route) test.selectedTarget = targetSummary(chunk.route)
        if (chunk.kind === 'assistant_text_delta') output = appendBounded(output, chunk.text, MAX_TEST_OUTPUT_CHARS)
        if (chunk.kind === 'error') {
          test.error = {
            message: chunk.message.slice(0, MAX_TEST_ERROR_CHARS),
            ...(chunk.code ? { code: chunk.code } : {}),
            ...(chunk.failure?.category ? { category: chunk.failure.category } : {})
          }
        }
      }
      test.output = output
      test.status = test.error ? 'failed' : 'succeeded'
    } catch (error) {
      test.status = 'failed'
      test.error = { message: safeMessage(error).slice(0, MAX_TEST_ERROR_CHARS), code: 'route_test_error' }
    } finally {
      test.completedAt = this.isoNow()
      test.attempts = attemptsForTest(this.health.snapshot(test.poolId).events, test.id)
    }
  }

  private request(test: MutableRoutePoolTestRecord, signal: AbortSignal): ModelRequest {
    const threadId = `route_test_${test.id}`
    const turnId = `route_test_turn_${test.id}`
    const history: TurnItem[] = [{
      id: `route_test_prompt_${test.id}`,
      turnId,
      threadId,
      kind: 'user_message',
      role: 'user',
      status: 'completed',
      createdAt: test.createdAt,
      text: 'Reply with OK.'
    }]
    return {
      threadId,
      turnId,
      model: test.modelId,
      providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID,
      routeTestId: test.id,
      prefix: [],
      history,
      tools: [],
      stream: true,
      abortSignal: signal
    }
  }

  private snapshot(test: MutableRoutePoolTestRecord): RoutePoolTestRecord {
    const attempts = test.attempts ?? attemptsForTest(this.health.snapshot(test.poolId).events, test.id)
    const current = attempts.find((attempt) => attempt.status === 'running')
    const selectedTarget = test.selectedTarget ?? attempts.find((attempt) => attempt.status === 'succeeded')
    return structuredClone({
      ...test,
      attemptedTargets: attempts.length,
      attempts,
      ...(current ? { currentTarget: targetSummary(current) } : {}),
      ...(selectedTarget ? { selectedTarget: targetSummary(selectedTarget) } : {})
    })
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString()
  }
}

function attemptsForTest(events: readonly ModelRouteEvent[], testId: string): RoutePoolTestAttempt[] {
  const attempts: RoutePoolTestAttempt[] = []
  const byTarget = new Map<string, RoutePoolTestAttempt>()
  for (const event of events) {
    if (event.testId !== testId) continue
    let attempt = byTarget.get(event.targetId)
    if (!attempt) {
      attempt = {
        index: attempts.length + 1,
        targetId: event.targetId,
        providerId: event.providerId,
        modelId: event.modelId,
        status: 'running',
        startedAt: event.at
      }
      byTarget.set(event.targetId, attempt)
      attempts.push(attempt)
    }
    if (event.result === 'success' || event.result === 'failure') {
      attempt.status = event.result === 'success' ? 'succeeded' : 'failed'
      attempt.completedAt = event.at
      attempt.latencyMs = event.latencyMs
      if (event.category) attempt.category = event.category
      if (event.message) attempt.message = event.message
    }
  }
  return attempts
}

function targetSummary(value: Pick<ModelRouteTargetMetadata, 'targetId' | 'providerId' | 'modelId'>): Pick<ModelRouteTargetMetadata, 'targetId' | 'providerId' | 'modelId'> {
  return { targetId: value.targetId, providerId: value.providerId, modelId: value.modelId }
}

function isActive(status: RoutePoolTestStatus): boolean {
  return status === 'queued' || status === 'running'
}

function appendBounded(current: string, next: string, max: number): string {
  return `${current}${next}`.slice(0, max)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
