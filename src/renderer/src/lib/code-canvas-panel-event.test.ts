import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_CANVAS_OPEN_REQUEST_EVENT,
  requestCodeCanvasPanelOpen
} from './code-canvas-panel-event'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestCodeCanvasPanelOpen', () => {
  it('dispatches the shared workbench canvas-open request', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    requestCodeCanvasPanelOpen()

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: CODE_CANVAS_OPEN_REQUEST_EVENT
    })
  })
})
