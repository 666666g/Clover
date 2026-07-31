/**
 * Thread ids are opaque identifiers, not filesystem paths. Keeping this
 * constraint at the contract boundary prevents a decoded HTTP path segment
 * from becoming a path traversal in either persistent store.
 */
export const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isSafeThreadId(value: string): boolean {
  return THREAD_ID_PATTERN.test(value)
}

export function assertSafeThreadId(value: string): void {
  if (!isSafeThreadId(value)) {
    throw new Error(`invalid thread id: ${value}`)
  }
}
