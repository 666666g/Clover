const MAX_SSE_FRAME_DELIMITER_LENGTH = 4
const FRAME_PART_COMPACTION_WINDOW = 256
const INPUT_QUEUE_COMPACTION_WINDOW = 1_024

export type SseFrame = {
  data: string
  delimiter: string
}

type BoundaryScan = {
  index: number
  length: number
  inspectedCharacters: number
}

/**
 * Incrementally locates SSE frame delimiters without rescanning or repeatedly
 * copying an unterminated frame after every network read. Incoming decoded
 * chunks stay separate, with only the three-character delimiter overlap
 * carried into the next scan. Frame content is joined once at completion.
 */
export class IncrementalSseFrameBuffer {
  private inputChunks: Array<string | undefined> = []
  private inputIndex = 0
  private activeText = ''
  private delimiterTail = ''
  private frameBlocks: string[] = []
  private frameParts: string[] = []
  private inspectedCharactersValue = 0

  append(text: string): void {
    if (!text) return
    this.inputChunks.push(text)
  }

  takeFrame(): SseFrame | null {
    while (true) {
      if (!this.activeText) {
        const chunk = this.takeInputChunk()
        if (chunk === undefined) return null
        this.activeText = this.delimiterTail ? this.delimiterTail + chunk : chunk
        this.delimiterTail = ''
      }

      const scan = scanForFrameBoundary(this.activeText)
      this.inspectedCharactersValue += scan.inspectedCharacters
      if (scan.index >= 0) {
        this.appendFramePart(this.activeText.slice(0, scan.index))
        const delimiter = this.activeText.slice(scan.index, scan.index + scan.length)
        this.activeText = this.activeText.slice(scan.index + scan.length)
        return { data: this.takeFrameData(), delimiter }
      }

      const retainedTailLength = Math.min(
        MAX_SSE_FRAME_DELIMITER_LENGTH - 1,
        this.activeText.length
      )
      const committedLength = this.activeText.length - retainedTailLength
      this.appendFramePart(this.activeText.slice(0, committedLength))
      this.delimiterTail = this.activeText.slice(committedLength)
      this.activeText = ''
    }
  }

  clear(): void {
    this.inputChunks = []
    this.inputIndex = 0
    this.activeText = ''
    this.delimiterTail = ''
    this.frameBlocks = []
    this.frameParts = []
  }

  /** Exposed for parser-work diagnostics and deterministic regression tests. */
  get inspectedCharacters(): number {
    return this.inspectedCharactersValue
  }

  private takeInputChunk(): string | undefined {
    const chunk = this.inputChunks[this.inputIndex]
    if (chunk === undefined) return undefined
    this.inputChunks[this.inputIndex] = undefined
    this.inputIndex += 1
    if (
      this.inputIndex >= INPUT_QUEUE_COMPACTION_WINDOW &&
      this.inputIndex * 2 >= this.inputChunks.length
    ) {
      this.inputChunks.splice(0, this.inputIndex)
      this.inputIndex = 0
    }
    return chunk
  }

  private appendFramePart(value: string): void {
    if (!value) return
    this.frameParts.push(value)
    if (this.frameParts.length < FRAME_PART_COMPACTION_WINDOW) return
    this.frameBlocks.push(this.frameParts.join(''))
    this.frameParts = []
  }

  private takeFrameData(): string {
    const finalPart = this.frameParts.join('')
    const data = finalPart
      ? [...this.frameBlocks, finalPart].join('')
      : this.frameBlocks.join('')
    this.frameBlocks = []
    this.frameParts = []
    return data
  }
}

function scanForFrameBoundary(value: string): BoundaryScan {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index)
    if (current === 13 && value.charCodeAt(index + 1) === 10) {
      const next = value.charCodeAt(index + 2)
      if (next === 10) {
        return { index, length: 3, inspectedCharacters: index + 1 }
      }
      if (next === 13 && value.charCodeAt(index + 3) === 10) {
        return { index, length: 4, inspectedCharacters: index + 1 }
      }
    }
    if (current === 10) {
      const next = value.charCodeAt(index + 1)
      if (next === 10) {
        return { index, length: 2, inspectedCharacters: index + 1 }
      }
      if (next === 13 && value.charCodeAt(index + 2) === 10) {
        return { index, length: 3, inspectedCharacters: index + 1 }
      }
    }
  }
  return { index: -1, length: 0, inspectedCharacters: value.length }
}
