import { describe, expect, it, vi } from 'vitest'
// Initialize the LocalToolHost/builtin catalog before importing ReviewService.
// The production composition root follows this order as well.
import '../src/adapters/tool/local-tool-host.js'
import { ThreadService } from '../src/services/thread-service.js'

describe('ReviewService isolation', () => {
  it('creates the isolated reviewer with a read-only sandbox', async () => {
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore: {} as never,
      turns: {} as never,
      model: {} as never,
      defaultModel: 'test-model',
      nowIso: () => '2026-07-10T00:00:00.000Z'
    })
    let request: { approvalPolicy?: string; sandboxMode?: string } | undefined
    const create = vi.spyOn(ThreadService.prototype, 'create').mockImplementation(async (input) => {
      request = input
      throw new Error('stop after capturing child thread request')
    })
    const isolated = service as unknown as {
      runIsolatedReviewer(input: {
        prompt: string
        workspace: string
        model: string
        signal: AbortSignal
      }): Promise<string>
    }

    try {
      await expect(isolated.runIsolatedReviewer({
        prompt: 'Review an untrusted diff.',
        workspace: '/workspace/project',
        model: 'test-model',
        signal: new AbortController().signal
      })).rejects.toThrow('stop after capturing child thread request')
    } finally {
      create.mockRestore()
    }

    expect(request).toMatchObject({
      approvalPolicy: 'auto',
      sandboxMode: 'read-only'
    })
  })
})
