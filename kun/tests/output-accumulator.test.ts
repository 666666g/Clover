import { describe, expect, it } from 'vitest'
import { OutputAccumulator } from '../src/adapters/tool/output-accumulator.js'

function createAccumulator(): OutputAccumulator {
  return new OutputAccumulator({
    maxLines: 200,
    maxBytes: 20_000,
    tempFilePrefix: 'kun-output-test'
  })
}

describe('OutputAccumulator', () => {
  it('decodes UTF-8 command output', () => {
    const output = createAccumulator()

    output.append(Buffer.from('hello\n世界', 'utf8'))
    output.finish()

    expect(output.snapshot().content).toBe('hello\n世界')
  })

  it('decodes UTF-16LE command output from Windows PowerShell pipes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('Start-Process\r\n浏览.html', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('Start-Process\r\n浏览.html')
  })

  it('decodes UTF-16LE command output without ASCII NUL bytes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('测试', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('测试')
  })

  it('keeps only a bounded preview when full-output persistence is disabled', () => {
    const output = new OutputAccumulator({
      maxLines: 2,
      maxBytes: 16,
      tempFilePrefix: 'kun-output-test',
      persistFullOutput: false
    })

    output.append(Buffer.from('x'.repeat(1_024), 'utf8'))
    output.finish()

    const snapshot = output.snapshot({ persistIfTruncated: true })
    expect(snapshot.truncation.truncated).toBe(true)
    expect(snapshot.fullOutputPath).toBeUndefined()
    expect(Buffer.byteLength(snapshot.content, 'utf8')).toBeLessThanOrEqual(16)
  })
})
