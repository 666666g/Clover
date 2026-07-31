import type { DesignArtifact } from '../design-types'
import { parseAndSanitizeSvgDocument } from './svg-document'

export function svgArtifactStatusForSource(
  content: string
): NonNullable<DesignArtifact['previewStatus']> {
  const parsed = parseAndSanitizeSvgDocument(content)
  if (!parsed.ok) {
    const parserUnavailable = parsed.diagnostics.some((item) => item.code === 'dom-parser-unavailable')
    if (!parserUnavailable) return 'error'
    // Vitest and other non-renderer consumers do not expose DOMParser. Mirror
    // the renderer sanitizer closely enough to keep status decisions stable.
    const source = content.trim()
    const startsWithSvg = /^<svg\b/i.test(source)
    const startsWithXmlDeclaration = /^<\?xml\b[^>]*>\s*<svg\b/i.test(source)
    if (
      (!startsWithSvg && !startsWithXmlDeclaration) ||
      !/<\/svg>\s*$/i.test(source) ||
      /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet\b/i.test(source)
    ) {
      return 'error'
    }
    const viewBox = /<svg\b[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i.exec(source)?.[1]
    if (viewBox) {
      const numbers = viewBox.trim().split(/[\s,]+/).map(Number)
      if (numbers.length !== 4 || !numbers.every(Number.isFinite) || numbers[2] <= 0 || numbers[3] <= 0) {
        return 'error'
      }
    }
    const sanitized = source
      .replace(/<(?:script|foreignObject)\b[^>]*\/>/gi, ' ')
      .replace(/<(script|foreignObject)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(defs|symbol|clipPath|mask|marker|pattern|filter)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    return /<(?:path|rect|circle|ellipse|line|polyline|polygon|text|use|image)\b/i.test(sanitized)
      ? 'ready'
      : 'pending'
  }
  return parsed.visualElementCount > 0 ? 'ready' : 'pending'
}
