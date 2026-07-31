import { describe, expect, it } from 'vitest'
import { IncrementalSseFrameBuffer } from './incremental-sse-frame-buffer.js'

describe('IncrementalSseFrameBuffer', () => {
  it('bounds scan work for an unterminated frame arriving one character at a time', () => {
    const frames = new IncrementalSseFrameBuffer()
    const unterminated = `data: ${'x'.repeat(20_000)}`

    for (const character of unterminated) {
      frames.append(character)
      expect(frames.takeFrame()).toBeNull()
    }

    // The parser only revisits the three-character delimiter overlap. A
    // start-at-zero implementation would inspect roughly n²/2 characters.
    expect(frames.inspectedCharacters).toBeLessThanOrEqual(unterminated.length * 4)

    // Check every partial boundary before the final byte completes it.
    frames.append('\r')
    expect(frames.takeFrame()).toBeNull()
    frames.append('\n')
    expect(frames.takeFrame()).toBeNull()
    frames.append('\r')
    expect(frames.takeFrame()).toBeNull()
    frames.append('\n')
    expect(frames.takeFrame()).toEqual({ data: unterminated, delimiter: '\r\n\r\n' })
  })

  it('preserves LF and mixed CRLF/LF framing when multiple frames are buffered', () => {
    const frames = new IncrementalSseFrameBuffer()
    frames.append('data: one\n\ndata: two\r\n\ndata: three\n\r\n')

    expect(frames.takeFrame()).toEqual({ data: 'data: one', delimiter: '\n\n' })
    expect(frames.takeFrame()).toEqual({ data: 'data: two', delimiter: '\r\n\n' })
    expect(frames.takeFrame()).toEqual({ data: 'data: three', delimiter: '\n\r\n' })
    expect(frames.takeFrame()).toBeNull()
  })
})
