import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import safeRegex from 'safe-regex2'

const MAX_SCHEMA_BYTES = 128 * 1024
const MAX_VALIDATION_ERRORS = 8
const MAX_SCHEMA_DEPTH = 64
const MAX_SCHEMA_NODES = 4_096
const MAX_PATTERN_LENGTH = 2_048

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  useDefaults: false,
  validateFormats: false
})

export type ExtensionJsonSchemaValidator = {
  assert(value: unknown, subject: string): void
}

/**
 * Compile an extension-owned JSON Schema once at its registration boundary.
 * Validation is deliberately non-mutating: schemas cannot coerce values,
 * insert defaults, or remove properties before a command/tool handler sees
 * the payload.
 */
export function compileExtensionJsonSchema(
  schema: Record<string, unknown>,
  schemaSubject: string
): ExtensionJsonSchemaValidator {
  const bytes = serializedBytes(schema)
  if (bytes > MAX_SCHEMA_BYTES) {
    throw new Error(`${schemaSubject} JSON Schema exceeds ${MAX_SCHEMA_BYTES} bytes`)
  }
  assertSchemaSafety(schema, schemaSubject)

  let validate: ValidateFunction
  try {
    validate = ajv.compile(structuredClone(schema))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${schemaSubject} JSON Schema: ${message.slice(0, 2_048)}`)
  }

  return {
    assert(value, subject) {
      if (validate(value)) return
      throw new Error(`${subject} does not match its declared JSON Schema: ${formatErrors(validate.errors)}`)
    }
  }
}

/**
 * JSON Schema is executable policy inside the trusted Kun process. Keep
 * extension-owned schemas finite and reject regexes that can cause catastrophic
 * backtracking before Ajv compiles them. External references are deliberately
 * unsupported so validation cannot depend on network or mutable documents.
 */
function assertSchemaSafety(schema: Record<string, unknown>, subject: string): void {
  const pending: Array<{ value: unknown; depth: number; path: string }> = [
    { value: schema, depth: 0, path: '$' }
  ]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > MAX_SCHEMA_NODES) {
      throw new Error(`${subject} JSON Schema exceeds ${MAX_SCHEMA_NODES} nodes`)
    }
    if (current.depth > MAX_SCHEMA_DEPTH) {
      throw new Error(`${subject} JSON Schema exceeds depth ${MAX_SCHEMA_DEPTH}`)
    }
    if (!current.value || typeof current.value !== 'object') continue
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`
        })
      }
      continue
    }

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      if ((key === '$ref' || key === '$dynamicRef' || key === '$recursiveRef') &&
          (typeof value !== 'string' || (value !== '#' && !value.startsWith('#/')))) {
        throw new Error(`${subject} JSON Schema contains unsupported external reference at ${current.path}.${key}`)
      }
      if (key === 'pattern' && typeof value === 'string') {
        assertSafePattern(value, `${current.path}.pattern`, subject)
      }
      if (key === 'patternProperties' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const pattern of Object.keys(value as Record<string, unknown>)) {
          assertSafePattern(pattern, `${current.path}.patternProperties`, subject)
        }
      }
      pending.push({ value, depth: current.depth + 1, path: `${current.path}.${key}` })
    }
  }
  assertAcyclicLocalReferences(schema, subject)
}

function assertSafePattern(pattern: string, path: string, subject: string): void {
  if (
    pattern.length > MAX_PATTERN_LENGTH ||
    !safeRegex(pattern, { limit: 25 }) ||
    hasAmbiguousQuantifiedAlternation(pattern)
  ) {
    throw new Error(`${subject} JSON Schema contains an unsafe regular expression at ${path}`)
  }
}

function assertAcyclicLocalReferences(schema: Record<string, unknown>, subject: string): void {
  const visited = new Set<object>()
  const visiting = new Set<object>()
  const references = collectLocalReferences(schema, false)

  const visitReference = (reference: string): void => {
    const target = resolveLocalReference(schema, reference)
    if (!target || typeof target !== 'object') return
    if (visiting.has(target)) {
      throw new Error(`${subject} JSON Schema contains a cyclic local reference at ${reference}`)
    }
    if (visited.has(target)) return

    visiting.add(target)
    for (const nestedReference of collectLocalReferences(target, true)) {
      visitReference(nestedReference)
    }
    visiting.delete(target)
    visited.add(target)
  }

  for (const reference of references) visitReference(reference)
}

function collectLocalReferences(value: unknown, skipDefinitions: boolean): string[] {
  const references: string[] = []
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (key === '$ref' || key === '$dynamicRef' || key === '$recursiveRef') {
        if (typeof child === 'string' && (child === '#' || child.startsWith('#/'))) {
          references.push(child)
        }
        continue
      }
      // Definitions declare schemas but do not evaluate them. Each reference
      // found by the outer scan is checked independently, so descending into a
      // target's sibling definitions here would create false dependency cycles.
      if (skipDefinitions && (key === '$defs' || key === 'definitions')) continue
      pending.push(child)
    }
  }
  return references
}

function resolveLocalReference(root: Record<string, unknown>, reference: string): unknown {
  if (reference === '#') return root
  let current: unknown = root
  for (const encodedSegment of reference.slice(2).split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(encodedSegment).replace(/~1/g, '/').replace(/~0/g, '~')
    } catch {
      return undefined
    }
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * safe-regex2 catches nested quantifiers, but not ambiguous repeated
 * alternatives such as `(a|aa)+`. On a failing suffix those alternatives have
 * exponentially many partitions. Reject literal alternatives where one branch
 * is a prefix of another whenever the containing group is repeatedly quantified.
 */
function hasAmbiguousQuantifiedAlternation(pattern: string): boolean {
  const groups: number[] = []
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[') {
      inCharacterClass = true
      continue
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (character === '(') {
      groups.push(index)
      continue
    }
    if (character !== ')' || groups.length === 0) continue

    const start = groups.pop()!
    if (!isRepeatedQuantifier(pattern, index + 1)) continue
    if (containsAmbiguousLiteralAlternation(pattern.slice(start + 1, index))) return true
  }
  return false
}

function containsAmbiguousLiteralAlternation(body: string): boolean {
  const normalized = stripNonCapturingPrefix(body)
  const alternatives = splitTopLevelAlternatives(normalized)
  if (alternatives.length >= 2) {
    const literals = alternatives.map(literalAlternative)
    if (!literals.some((literal) => literal === undefined)) {
      for (let left = 0; left < literals.length; left += 1) {
        for (let right = left + 1; right < literals.length; right += 1) {
          const a = literals[left]!
          const b = literals[right]!
          if (a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a))) return true
        }
      }
    }
  }

  const groups: number[] = []
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[') {
      inCharacterClass = true
      continue
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (character === '(') groups.push(index)
    else if (character === ')' && groups.length > 0) {
      const start = groups.pop()!
      if (containsAmbiguousLiteralAlternation(normalized.slice(start + 1, index))) return true
    }
  }
  return false
}

function isRepeatedQuantifier(pattern: string, index: number): boolean {
  const quantifier = pattern[index]
  if (quantifier === '*' || quantifier === '+') return true
  if (quantifier !== '{') return false
  const close = pattern.indexOf('}', index + 1)
  if (close < 0) return false
  const body = pattern.slice(index + 1, close)
  const match = /^(\d+)(?:,(\d*)?)?$/.exec(body)
  if (!match) return false
  const minimum = Number(match[1])
  const maximum = match[2] === undefined
    ? minimum
    : match[2] === ''
      ? Number.POSITIVE_INFINITY
      : Number(match[2])
  return maximum > 1
}

function stripNonCapturingPrefix(body: string): string {
  return body.startsWith('?:') ? body.slice(2) : body
}

function splitTopLevelAlternatives(body: string): string[] {
  const alternatives: string[] = []
  let start = 0
  let depth = 0
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[') {
      inCharacterClass = true
      continue
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === '|' && depth === 0) {
      alternatives.push(body.slice(start, index))
      start = index + 1
    }
  }
  alternatives.push(body.slice(start))
  return alternatives
}

function literalAlternative(alternative: string): string | undefined {
  let literal = ''
  for (let index = 0; index < alternative.length; index += 1) {
    const character = alternative[index]
    if (character === '\\') {
      const escaped = alternative[index + 1]
      if (escaped === undefined || /[bBdDsSwWkKpPuUx0-9]/.test(escaped)) return undefined
      literal += escaped
      index += 1
      continue
    }
    if ('^$.*+?()[]{}|'.includes(character)) return undefined
    literal += character
  }
  return literal
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'validation failed'
  return errors
    .slice(0, MAX_VALIDATION_ERRORS)
    .map((error) => {
      const path = error.instancePath || '$'
      const message = error.message ?? error.keyword
      return `${path} ${message}`
    })
    .join('; ')
    .slice(0, 4_096)
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
  } catch {
    throw new Error('extension JSON Schema must be JSON serializable')
  }
}
