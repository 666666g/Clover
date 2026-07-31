import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { redactSecretText } from '../config/secret-redaction.js'

export type ExtensionLogWriterOptions = {
  maxBytes?: number
  retention?: number
  now?: () => Date
}

export const DEFAULT_EXTENSION_LOG_BYTES = 5 * 1024 * 1024
export const DEFAULT_EXTENSION_LOG_RETENTION = 3

export class ExtensionLogWriter {
  private operation: Promise<void> = Promise.resolve()
  private readonly partial = new Map<string, string>()
  private readonly maxBytes: number
  private readonly retention: number
  private readonly now: () => Date

  constructor(
    readonly path: string,
    options: ExtensionLogWriterOptions = {}
  ) {
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_EXTENSION_LOG_BYTES)
    this.retention = positiveInteger(options.retention, DEFAULT_EXTENSION_LOG_RETENTION)
    this.now = options.now ?? (() => new Date())
  }

  write(channel: 'stdout' | 'stderr' | 'lifecycle', chunk: string | Buffer): Promise<void> {
    const incoming = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
    const terminated = channel === 'lifecycle' && !incoming.endsWith('\n') ? `${incoming}\n` : incoming
    const text = `${this.partial.get(channel) ?? ''}${terminated}`
    const lines = text.split(/\r?\n/)
    let remainder = lines.pop() ?? ''
    while (remainder.length > 64_000) {
      lines.push(`${remainder.slice(0, 64_000)}…[continued]`)
      remainder = remainder.slice(64_000)
    }
    this.partial.set(channel, remainder)
    const records = lines.map((line) => this.format(channel, line)).join('')
    if (records.length === 0) return this.operation
    return this.serialize(() => this.appendBounded(records))
  }

  flush(): Promise<void> {
    const records: string[] = []
    for (const [channel, value] of this.partial) {
      if (value !== '') records.push(this.format(channel, value))
    }
    this.partial.clear()
    if (records.length === 0) return this.operation
    return this.serialize(() => this.appendBounded(records.join('')))
  }

  private format(channel: string, line: string): string {
    const redacted = redactSecretText(line)
    const bounded = redacted.length > 64_000
      ? `${redacted.slice(0, 64_000)}…[truncated]`
      : redacted
    return `${this.now().toISOString()} [${channel}] ${bounded}\n`
  }

  private async appendBounded(contents: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const bytes = Buffer.byteLength(contents)
    const current = await stat(this.path).then((value) => value.size, () => 0)
    if (current + bytes > this.maxBytes) await this.rotate()
    const encoded = Buffer.from(contents, 'utf8')
    const marker = Buffer.from('\n[log record truncated]\n', 'utf8')
    const bounded = encoded.length > this.maxBytes
      ? Buffer.concat([encoded.subarray(0, Math.max(0, this.maxBytes - marker.length)), marker])
      : encoded
    await appendFile(this.path, bounded, { mode: 0o600 })
  }

  private async rotate(): Promise<void> {
    await rm(`${this.path}.${this.retention}`, { force: true }).catch(() => undefined)
    for (let index = this.retention - 1; index >= 1; index -= 1) {
      await rename(`${this.path}.${index}`, `${this.path}.${index + 1}`).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      })
    }
    await rename(this.path, `${this.path}.1`).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    })
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation)
    this.operation = result.catch(() => undefined)
    return result
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error('Invalid log limit')
  return resolved
}
