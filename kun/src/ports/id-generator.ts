/**
 * Port for ids. Keeping id allocation behind a tiny interface makes
 * services deterministic in tests and avoids scattering random suffix
 * details through the application layer.
 */
export interface IdGenerator {
  next(prefix: string): string
}

export class RandomIdGenerator implements IdGenerator {
  /** Optional deterministic source exists solely for unit tests. */
  constructor(private readonly random?: () => number) {}

  next(prefix: string): string {
    if (this.random) return `${prefix}_${this.random().toString(36).slice(2, 10)}`
    return `${prefix}_${randomUUID().replaceAll('-', '')}`
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private nextSeq = 0

  next(prefix: string): string {
    this.nextSeq += 1
    return `${prefix}_${this.nextSeq}`
  }
}
import { randomUUID } from 'node:crypto'
