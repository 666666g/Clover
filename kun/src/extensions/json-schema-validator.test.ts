import { describe, expect, it } from 'vitest'
import { compileExtensionJsonSchema } from './json-schema-validator.js'

describe('compileExtensionJsonSchema', () => {
  it('supports bounded local definitions without mutating validated input', () => {
    const validator = compileExtensionJsonSchema({
      type: 'object',
      properties: {
        value: { $ref: '#/$defs/value' }
      },
      required: ['value'],
      additionalProperties: false,
      $defs: {
        value: { type: 'string', pattern: '^[a-z0-9-]{1,32}$' }
      }
    }, 'test')
    const input = { value: 'safe-value' }

    validator.assert(input, 'input')
    expect(input).toEqual({ value: 'safe-value' })
    expect(() => validator.assert({ value: 'UPPER' }, 'input')).toThrow(/declared JSON Schema/)
  })

  it('rejects external references and catastrophic regular expressions before compilation', () => {
    expect(() => compileExtensionJsonSchema({
      $ref: 'https://schemas.example.test/tool.json'
    }, 'remote')).toThrow(/unsupported external reference/)
    expect(() => compileExtensionJsonSchema({
      type: 'string',
      pattern: '(a+)+$'
    }, 'unsafe')).toThrow(/unsafe regular expression/)
    expect(() => compileExtensionJsonSchema({
      type: 'object',
      patternProperties: { '(x*)*$': { type: 'string' } }
    }, 'unsafe properties')).toThrow(/unsafe regular expression/)
    expect(() => compileExtensionJsonSchema({
      type: 'string',
      pattern: '^(?:a|aa)+$'
    }, 'ambiguous alternation')).toThrow(/unsafe regular expression/)
    expect(() => compileExtensionJsonSchema({
      type: 'string',
      pattern: '^((?:a|aa))+$'
    }, 'nested ambiguous alternation')).toThrow(/unsafe regular expression/)

    const safeAlternation = compileExtensionJsonSchema({
      type: 'string',
      pattern: '^(?:foo|bar)+$'
    }, 'safe alternation')
    safeAlternation.assert('foobar', 'input')
  })

  it('rejects direct and indirect cyclic local references before validation', () => {
    expect(() => compileExtensionJsonSchema({ $ref: '#' }, 'direct cycle'))
      .toThrow(/cyclic local reference/)
    expect(() => compileExtensionJsonSchema({
      $ref: '#/$defs/first',
      $defs: {
        first: { $ref: '#/$defs/second' },
        second: { $ref: '#/$defs/first' }
      }
    }, 'indirect cycle')).toThrow(/cyclic local reference/)
  })

  it('rejects schemas whose object graph exceeds the bounded nesting depth', () => {
    const schema: Record<string, unknown> = { type: 'object' }
    let cursor = schema
    for (let index = 0; index < 70; index += 1) {
      const child: Record<string, unknown> = { type: 'object' }
      cursor.properties = { child }
      cursor = child
    }

    expect(() => compileExtensionJsonSchema(schema, 'deep')).toThrow(/exceeds depth/)
  })
})
