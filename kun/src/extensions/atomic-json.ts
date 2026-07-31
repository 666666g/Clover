import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { extensionError } from './errors.js'

export type JsonValidator<T> = (value: unknown) => T

export class AtomicJsonFile<T> {
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly validate: JsonValidator<T>
  ) {}

  async read(fallback: () => T): Promise<T> {
    try {
      const contents = await readFile(this.path, 'utf8')
      return this.validate(JSON.parse(contents) as unknown)
    } catch (error) {
      if (isMissingFile(error)) return fallback()
      if (error instanceof SyntaxError) {
        throw extensionError('EXTENSION_JSON_INVALID', 'Persisted extension JSON is malformed', {
          path: this.path
        }, error)
      }
      throw error
    }
  }

  async write(value: T): Promise<void> {
    const validated = this.validate(value)
    await atomicWriteFile(this.path, `${JSON.stringify(validated, null, 2)}\n`)
  }

  async update(fallback: () => T, mutate: (current: T) => T | Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const current = await this.read(fallback)
      const next = this.validate(await mutate(current))
      await this.write(next)
      return next
    })
  }

  private serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
