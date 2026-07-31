export type WorkbenchContextValue = string | number | boolean | null | undefined
export type WorkbenchContext = Readonly<Record<string, WorkbenchContextValue>>

type TokenKind =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'not'
  | 'and'
  | 'or'
  | 'equal'
  | 'notEqual'
  | 'leftParen'
  | 'rightParen'
  | 'eof'

type Token = { kind: TokenKind; value?: WorkbenchContextValue }

const MAX_EXPRESSION_LENGTH = 2_048
const MAX_TOKEN_COUNT = 256

export class WhenExpressionError extends Error {
  readonly code = 'EXTENSION_WHEN_EXPRESSION_INVALID'
}

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new WhenExpressionError('when expression exceeds the supported length')
  }
  const tokens: Token[] = []
  let cursor = 0

  const push = (token: Token): void => {
    tokens.push(token)
    if (tokens.length > MAX_TOKEN_COUNT) {
      throw new WhenExpressionError('when expression contains too many tokens')
    }
  }

  while (cursor < expression.length) {
    const char = expression[cursor]!
    if (/\s/.test(char)) {
      cursor += 1
      continue
    }
    const pair = expression.slice(cursor, cursor + 2)
    if (pair === '&&') {
      push({ kind: 'and' })
      cursor += 2
      continue
    }
    if (pair === '||') {
      push({ kind: 'or' })
      cursor += 2
      continue
    }
    if (pair === '==') {
      push({ kind: 'equal' })
      cursor += 2
      continue
    }
    if (pair === '!=') {
      push({ kind: 'notEqual' })
      cursor += 2
      continue
    }
    if (char === '!') {
      push({ kind: 'not' })
      cursor += 1
      continue
    }
    if (char === '(' || char === ')') {
      push({ kind: char === '(' ? 'leftParen' : 'rightParen' })
      cursor += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      cursor += 1
      let closed = false
      while (cursor < expression.length) {
        const next = expression[cursor]!
        if (next === quote) {
          cursor += 1
          closed = true
          break
        }
        if (next === '\\') {
          const escaped = expression[cursor + 1]
          if (escaped !== quote && escaped !== '\\') {
            throw new WhenExpressionError('only quote and backslash escapes are supported')
          }
          value += escaped
          cursor += 2
          continue
        }
        value += next
        cursor += 1
      }
      if (!closed) throw new WhenExpressionError('unterminated string literal')
      push({ kind: 'string', value })
      continue
    }
    const numberMatch = expression.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?/)
    if (numberMatch) {
      push({ kind: 'number', value: Number(numberMatch[0]) })
      cursor += numberMatch[0].length
      continue
    }
    const identifierMatch = expression.slice(cursor).match(/^[A-Za-z][A-Za-z0-9._-]*/)
    if (identifierMatch) {
      const value = identifierMatch[0]
      if (value === 'true' || value === 'false') {
        push({ kind: 'boolean', value: value === 'true' })
      } else if (value === 'null') {
        push({ kind: 'null', value: null })
      } else {
        push({ kind: 'identifier', value })
      }
      cursor += value.length
      continue
    }
    throw new WhenExpressionError(`unsupported token at offset ${cursor}`)
  }

  push({ kind: 'eof' })
  return tokens
}

class Parser {
  private cursor = 0

  constructor(
    private readonly tokens: readonly Token[],
    private readonly context: WorkbenchContext
  ) {}

  parse(): boolean {
    const result = this.parseOr()
    if (this.peek().kind !== 'eof') throw new WhenExpressionError('unexpected trailing token')
    return Boolean(result)
  }

  private parseOr(): WorkbenchContextValue {
    let left = this.parseAnd()
    while (this.take('or')) {
      const right = this.parseAnd()
      left = Boolean(left) || Boolean(right)
    }
    return left
  }

  private parseAnd(): WorkbenchContextValue {
    let left = this.parseEquality()
    while (this.take('and')) {
      const right = this.parseEquality()
      left = Boolean(left) && Boolean(right)
    }
    return left
  }

  private parseEquality(): WorkbenchContextValue {
    let left = this.parseUnary()
    for (;;) {
      if (this.take('equal')) {
        left = left === this.parseUnary()
        continue
      }
      if (this.take('notEqual')) {
        left = left !== this.parseUnary()
        continue
      }
      return left
    }
  }

  private parseUnary(): WorkbenchContextValue {
    if (this.take('not')) return !this.parseUnary()
    if (this.take('leftParen')) {
      const result = this.parseOr()
      if (!this.take('rightParen')) throw new WhenExpressionError('missing closing parenthesis')
      return result
    }
    const token = this.peek()
    if (token.kind === 'identifier') {
      this.cursor += 1
      return this.context[String(token.value)]
    }
    if (token.kind === 'string' || token.kind === 'number' || token.kind === 'boolean' || token.kind === 'null') {
      this.cursor += 1
      return token.value
    }
    throw new WhenExpressionError('expected a context key or literal')
  }

  private peek(): Token {
    return this.tokens[this.cursor] ?? { kind: 'eof' }
  }

  private take(kind: TokenKind): boolean {
    if (this.peek().kind !== kind) return false
    this.cursor += 1
    return true
  }
}

/** Unknown keys intentionally resolve to undefined/false. Invalid input also
 * fails closed and is reported separately by ContributionRegistry. */
export function evaluateWhenExpression(
  expression: string | undefined,
  context: WorkbenchContext
): boolean {
  if (!expression) return true
  try {
    return new Parser(tokenize(expression), context).parse()
  } catch {
    return false
  }
}

export function validateWhenExpression(expression: string | undefined): string | null {
  if (!expression) return null
  try {
    new Parser(tokenize(expression), {}).parse()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid when expression'
  }
}
