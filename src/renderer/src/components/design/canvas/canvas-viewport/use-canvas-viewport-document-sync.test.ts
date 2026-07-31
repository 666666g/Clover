import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDocument } from '../../../../design/canvas/canvas-types'
import { loadCanvasDocumentWithinDeadline } from './use-canvas-viewport-document-sync'

afterEach(() => {
  vi.useRealTimers()
})

describe('loadCanvasDocumentWithinDeadline', () => {
  it('returns a resolved canvas document', async () => {
    const document = createEmptyDocument()

    await expect(loadCanvasDocumentWithinDeadline(async () => document, 100)).resolves.toEqual({
      status: 'resolved',
      document
    })
  })

  it('settles a hung historical-board read instead of loading forever', async () => {
    vi.useFakeTimers()
    const pending = new Promise<never>(() => undefined)
    const result = loadCanvasDocumentWithinDeadline(() => pending, 100)

    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toEqual({ status: 'timeout', document: null })
  })

  it('normalizes rejected reads into a reconstructable result', async () => {
    await expect(
      loadCanvasDocumentWithinDeadline(async () => {
        throw new Error('read failed')
      }, 100)
    ).resolves.toEqual({ status: 'rejected', document: null })
  })
})
