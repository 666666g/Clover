import { z } from 'zod'
import { ExtensionIdentitySchema, JsonValueSchema, type ExtensionIdentity, type JsonValue } from './common.js'

export interface Disposable {
  dispose(): void | Promise<void>
}

export type DisposeLike = Disposable | (() => void | Promise<void>)

export function toDisposable(dispose: () => void | Promise<void>): Disposable {
  let active = true
  return {
    async dispose() {
      if (!active) return
      active = false
      await dispose()
    }
  }
}

export class DisposableStore implements Disposable {
  readonly #items = new Set<Disposable>()
  #disposed = false

  get isDisposed(): boolean {
    return this.#disposed
  }

  add<T extends Disposable>(item: T): T
  add(...items: DisposeLike[]): Disposable[]
  add(...items: DisposeLike[]): Disposable | Disposable[] {
    if (this.#disposed) {
      for (const item of items) void normalizeDisposable(item).dispose()
      return items.length === 1 ? normalizeDisposable(items[0]) : items.map(normalizeDisposable)
    }
    for (const item of items) this.#items.add(normalizeDisposable(item))
    return items.length === 1 ? normalizeDisposable(items[0]) : items.map(normalizeDisposable)
  }

  delete(item: Disposable): boolean {
    return this.#items.delete(item)
  }

  async clear(): Promise<void> {
    const items = [...this.#items].reverse()
    this.#items.clear()
    const errors: unknown[] = []
    for (const item of items) {
      try {
        await item.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Failed to dispose extension resources')
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.clear()
  }
}

function normalizeDisposable(item: DisposeLike): Disposable {
  return typeof item === 'function' ? toDisposable(item) : item
}

export type Event<T> = (listener: (event: T) => void) => Disposable

export class Emitter<T> implements Disposable {
  readonly #listeners = new Set<(event: T) => void>()
  #disposed = false

  readonly event: Event<T> = (listener) => {
    if (this.#disposed) return toDisposable(() => undefined)
    this.#listeners.add(listener)
    return toDisposable(() => {
      this.#listeners.delete(listener)
    })
  }

  fire(event: T): void {
    if (this.#disposed) return
    for (const listener of [...this.#listeners]) listener(event)
  }

  dispose(): void {
    this.#disposed = true
    this.#listeners.clear()
  }
}

export const WorkspaceContextSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  root: z.string().min(1).max(4096),
  trusted: z.boolean(),
  active: z.boolean()
})
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>

export const ActivationContextDataSchema = z.strictObject({
  extension: ExtensionIdentitySchema,
  apiVersion: z.string(),
  capabilities: z.array(z.string().min(1).max(128)),
  permissions: z.array(z.string().min(1).max(256)),
  workspaceContext: WorkspaceContextSchema.optional(),
  activationEvent: z.string().min(1).max(256),
  initialState: JsonValueSchema.optional()
})
export type ActivationContextData = z.infer<typeof ActivationContextDataSchema>

export interface StateMigrationContext {
  readonly extension: ExtensionIdentity
  readonly scope: 'global' | 'workspace'
  readonly workspace?: WorkspaceContext
  readonly fromVersion: number
  readonly toVersion: number
}

export type StateMigration = (
  state: JsonValue,
  context: StateMigrationContext
) => JsonValue | Promise<JsonValue>

export type Activate<TContext> = (context: TContext) => void | Promise<void>
export type Deactivate = () => void | Promise<void>
