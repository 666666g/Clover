import type { WriteInlineEditRequest, WriteInlineEditScopeKind } from '@shared/write-inline-edit'
import type { WriteSelectionRange } from '../components/write/WriteMarkdownEditor'
import type { WriteRecentEdit } from './recent-edits'
import { recentEditsForInlineEdit } from './recent-edits'

const INLINE_EDIT_PREFIX_WINDOW_CHARS = 6_000
const INLINE_EDIT_SUFFIX_WINDOW_CHARS = 4_000
const INLINE_EDIT_PARAGRAPH_SELECTION_MAX_CHARS = 120

export type WriteInlineEditResolvedScope = {
  kind: WriteInlineEditScopeKind
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  selectedText: string
}

export type WriteInlineEditDraft = {
  scope: WriteInlineEditResolvedScope
  request: WriteInlineEditRequest
}

type LineSpan = {
  from: number
  to: number
  text: string
}

function clampOffset(content: string, offset: number): number {
  const value = Number(offset)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(content.length, Math.floor(value)))
}

function clipHead(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(0, maxChars)
}

function clipTail(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(source.length - maxChars)
}

function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function buildLineSpans(content: string): LineSpan[] {
  const spans: LineSpan[] = []
  let from = 0
  while (from <= content.length) {
    const nextBreak = content.indexOf('\n', from)
    const to = nextBreak >= 0 ? nextBreak : content.length
    spans.push({
      from,
      to,
      text: content.slice(from, to)
    })
    if (nextBreak < 0) break
    from = nextBreak + 1
  }
  return spans.length > 0 ? spans : [{ from: 0, to: 0, text: '' }]
}

function lineIndexAtOffset(lines: LineSpan[], offset: number): number {
  const point = Math.max(0, offset)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nextLineStart = index + 1 < lines.length ? lines[index + 1].from : line.to + 1
    if (point >= line.from && point < nextLineStart) return index
  }
  return Math.max(0, lines.length - 1)
}

function lineColumnForOffset(content: string, offset: number): { line: number; column: number } {
  const point = clampOffset(content, offset)
  const before = content.slice(0, point)
  const lineBreaks = before.match(/\n/g)?.length ?? 0
  const lastBreak = before.lastIndexOf('\n')
  return {
    line: lineBreaks + 1,
    column: point - lastBreak
  }
}

function previousNonEmptyLine(lines: LineSpan[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const text = lines[index]?.text ?? ''
    if (text.trim()) return text
  }
  return ''
}

function shouldExpandSelectionToParagraph(range: WriteSelectionRange): boolean {
  const selected = range.text.trim()
  if (!selected) return false
  if (selected.length > INLINE_EDIT_PARAGRAPH_SELECTION_MAX_CHARS) return false
  return !/\n\s*\n/.test(range.text)
}

function isParagraphBoundaryLine(text: string): boolean {
  const trimmed = text.trim()
  return !trimmed ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^-{3,}$/.test(trimmed)
}

function resolveParagraphRange(content: string, range: WriteSelectionRange): { from: number; to: number } {
  const lines = buildLineSpans(content)
  const startIndex = lineIndexAtOffset(lines, clampOffset(content, range.from))
  const endIndex = lineIndexAtOffset(lines, clampOffset(content, Math.max(range.from, range.to - 1)))
  let first = startIndex
  let last = endIndex

  if (isParagraphBoundaryLine(lines[startIndex].text) || isParagraphBoundaryLine(lines[endIndex].text)) {
    return {
      from: lines[first].from,
      to: lines[last].to
    }
  }

  while (first > 0 && !isParagraphBoundaryLine(lines[first - 1].text)) first -= 1
  while (last + 1 < lines.length && !isParagraphBoundaryLine(lines[last + 1].text)) last += 1

  return {
    from: lines[first].from,
    to: lines[last].to
  }
}

export function resolveWriteInlineEditScope(
  content: string,
  range: WriteSelectionRange
): WriteInlineEditResolvedScope {
  const from = clampOffset(content, Math.min(range.from, range.to))
  const to = clampOffset(content, Math.max(range.from, range.to))
  const shouldExpand = shouldExpandSelectionToParagraph({
    ...range,
    from,
    to,
    text: content.slice(from, to)
  })
  const resolved = shouldExpand ? resolveParagraphRange(content, range) : { from, to }
  const safeFrom = clampOffset(content, resolved.from)
  const safeTo = clampOffset(content, Math.max(resolved.from, resolved.to))
  const start = lineColumnForOffset(content, safeFrom)
  const end = lineColumnForOffset(content, Math.max(safeFrom, safeTo - 1))

  return {
    kind: shouldExpand ? 'paragraph' : 'selection',
    from: safeFrom,
    to: safeTo,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    text: content.slice(safeFrom, safeTo),
    selectedText: content.slice(from, to)
  }
}

export function buildWriteInlineEditDraft(
  content: string,
  range: WriteSelectionRange,
  instruction: string,
  options: {
    workspaceRoot?: string
    currentFilePath?: string
    model?: string
    language?: string
    recentEdits?: WriteRecentEdit[]
    now?: number
  } = {}
): WriteInlineEditDraft {
  const scope = resolveWriteInlineEditScope(content, range)
  const lines = buildLineSpans(content)
  const startIndex = lineIndexAtOffset(lines, scope.from)
  const endIndex = lineIndexAtOffset(lines, Math.max(scope.from, scope.to - 1))
  const previousLine = startIndex > 0 ? lines[startIndex - 1].text : ''
  const nextLine = endIndex + 1 < lines.length ? lines[endIndex + 1].text : ''

  return {
    scope,
    request: {
      prefix: clipTail(content.slice(0, scope.from), INLINE_EDIT_PREFIX_WINDOW_CHARS),
      suffix: clipHead(content.slice(scope.to), INLINE_EDIT_SUFFIX_WINDOW_CHARS),
      original: scope.text,
      instruction,
      workspaceRoot: options.workspaceRoot,
      currentFilePath: options.currentFilePath,
      scope: {
        kind: scope.kind,
        from: scope.from,
        to: scope.to,
        startLine: scope.startLine,
        startColumn: scope.startColumn,
        endLine: scope.endLine,
        endColumn: scope.endColumn
      },
      context: {
        language: options.language || 'markdown',
        selectedText: scope.selectedText,
        previousLine,
        previousNonEmptyLine: previousNonEmptyLine(lines, startIndex - 1),
        nextLine
      },
      preview: {
        local: compactText(scope.text).slice(0, 240),
        documentTail: compactText(content.slice(Math.max(0, scope.from - 800), scope.from)).slice(0, 240)
      },
      recentEdits: options.currentFilePath
        ? recentEditsForInlineEdit(options.recentEdits ?? [], {
            currentFilePath: options.currentFilePath,
            scope,
            now: options.now
          })
        : undefined,
      model: options.model
    }
  }
}

export function applyWriteInlineEditReplacement(
  content: string,
  scope: WriteInlineEditResolvedScope,
  replacement: string
): string {
  return `${content.slice(0, scope.from)}${replacement}${content.slice(scope.to)}`
}
