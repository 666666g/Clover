export type Utf8Prefix = {
  end: number
  bytes: number
}

/**
 * Returns the largest code-point-safe prefix starting at `start` whose UTF-8
 * encoding fits within `maxBytes`. The caller can resume from `end` without
 * changing the original JavaScript string, including for lone surrogates.
 */
export function utf8PrefixWithinBytes(
  value: string,
  start: number,
  maxBytes: number
): Utf8Prefix {
  let end = Math.max(0, Math.min(value.length, start))
  let bytes = 0
  const limit = Math.max(0, Math.floor(maxBytes))
  while (end < value.length) {
    const codePoint = value.codePointAt(end)!
    const codeUnits = codePoint > 0xffff ? 2 : 1
    const nextBytes = utf8CodePointBytes(codePoint)
    if (bytes + nextBytes > limit) break
    bytes += nextBytes
    end += codeUnits
  }
  return { end, bytes }
}

function utf8CodePointBytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}
