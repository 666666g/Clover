import { parseDocument } from 'yaml'
import type { ProjectDesignMdOfficialLintResult } from '@shared/project-design-md'
import { PROJECT_DESIGN_MD_MAX_BYTES } from './design-md-paths'
import type {
  DesignMdDiagnostic,
  DesignMdDimension,
  DesignMdMarkdownSection,
  ProjectDesignMdDocument,
  ProjectDesignMdParseResult
} from './design-md-types'

const KNOWN_KEYS = new Set(['name', 'description', 'colors', 'typography', 'rounded', 'spacing', 'components'])
const REFERENCE_RE = /^\{([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)\}$/
const UNSAFE_CSS_RE = /(?:url\s*\(|@import|expression\s*\(|javascript:)/i
const MAX_REFERENCE_DEPTH = 32

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function projectDesignMdHash(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function splitSource(content: string): { yaml: string; markdown: string } | null {
  if (!content.startsWith('---')) return null
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)
  return match ? { yaml: match[1], markdown: content.slice(match[0].length) } : null
}

function parseSections(markdown: string): DesignMdMarkdownSection[] {
  const headings = [...markdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)]
  return headings.map((match, index) => ({
    heading: match[2],
    level: match[1].length,
    content: markdown.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? markdown.length).trim()
  }))
}

function rawDimension(value: unknown): DesignMdDimension {
  const raw = String(value ?? '')
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/i.exec(raw.trim())
  return match ? { raw, value: Number(match[1]), unit: match[2] } : { raw }
}

function valueAt(root: UnknownRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, root)
}

export function resolveDesignMdReference(root: UnknownRecord, value: unknown): unknown {
  let current = value
  const visited = new Set<string>()
  for (let depth = 0; depth < MAX_REFERENCE_DEPTH; depth += 1) {
    if (typeof current !== 'string') return current
    const match = REFERENCE_RE.exec(current.trim())
    if (!match) return current
    if (visited.has(match[1])) throw new Error(`Circular token reference: ${match[1]}`)
    visited.add(match[1])
    current = valueAt(root, match[1])
    if (current === undefined) throw new Error(`Unresolved token reference: ${match[1]}`)
  }
  throw new Error(`Token reference nesting exceeds ${MAX_REFERENCE_DEPTH}`)
}

function safetyDiagnostics(value: unknown, path = ''): DesignMdDiagnostic[] {
  if (typeof value === 'string' && UNSAFE_CSS_RE.test(value)) {
    return [{ severity: 'error', message: 'Unsafe CSS value is not allowed.', path, source: 'kun' }]
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) => safetyDiagnostics(child, path ? `${path}.${key}` : key))
}

export function parseProjectDesignMd(content: string, options?: {
  truncated?: boolean
  officialLint?: ProjectDesignMdOfficialLintResult | null
}): ProjectDesignMdParseResult {
  const diagnostics: DesignMdDiagnostic[] = []
  if (options?.truncated) diagnostics.push({ severity: 'error', message: 'DESIGN.md read was truncated.', source: 'kun' })
  if (new TextEncoder().encode(content).byteLength > PROJECT_DESIGN_MD_MAX_BYTES) {
    diagnostics.push({ severity: 'error', message: 'DESIGN.md exceeds the 512 KiB limit.', source: 'kun' })
  }
  const source = splitSource(content)
  if (!source) {
    diagnostics.push({ severity: 'error', message: 'DESIGN.md must start with a closed YAML front matter fence.', source: 'kun' })
    return { ok: false, document: null, diagnostics }
  }

  const yamlDocument = parseDocument(source.yaml, { strict: true, uniqueKeys: true })
  diagnostics.push(...yamlDocument.errors.map((error) => ({ severity: 'error' as const, message: error.message, source: 'kun' as const })))
  const root = yamlDocument.toJS() as unknown
  if (!isRecord(root)) {
    diagnostics.push({ severity: 'error', message: 'YAML front matter must be a mapping.', source: 'kun' })
    return { ok: false, document: null, diagnostics }
  }
  if (typeof root.name !== 'string' || !root.name.trim()) {
    diagnostics.push({ severity: 'error', message: 'Google-compatible DESIGN.md requires a non-empty top-level name.', path: 'name', source: 'kun' })
  }
  if (!['colors', 'typography', 'rounded', 'spacing', 'components'].some((key) => isRecord(root[key]) && Object.keys(root[key] as UnknownRecord).length > 0)) {
    diagnostics.push({ severity: 'error', message: 'DESIGN.md has no recognized Google design token sections.', source: 'kun' })
  }

  const official = options?.officialLint
  if (official?.ok) {
    diagnostics.push(...official.findings.map((finding) => ({ ...finding, source: 'google' as const })))
  } else if (official && !official.ok) {
    diagnostics.push({ severity: 'error', message: official.message, source: 'google' })
  }
  diagnostics.push(...safetyDiagnostics(root))

  const sections = parseSections(source.markdown)
  const duplicateHeadings = sections.map((section) => section.heading.toLowerCase()).filter((heading, index, all) => all.indexOf(heading) !== index)
  diagnostics.push(...duplicateHeadings.map((heading) => ({ severity: 'error' as const, message: `Duplicate Markdown section: ${heading}`, source: 'kun' as const })))

  for (const [sectionName, section] of Object.entries(root)) {
    if (!isRecord(section)) continue
    for (const [key, raw] of Object.entries(section)) {
      try { resolveDesignMdReference(root, raw) } catch (error) {
        diagnostics.push({ severity: 'error', message: error instanceof Error ? error.message : 'Invalid reference.', path: `${sectionName}.${key}`, source: 'kun' })
      }
    }
  }

  const resolved = official?.ok ? official : null
  const colors = Object.fromEntries(Object.entries(isRecord(root.colors) ? root.colors : {}).map(([key, raw]) => {
    const value = resolved?.colors[key]
    let localHex: string | undefined
    try {
      const candidate = String(resolveDesignMdReference(root, raw)).trim()
      if (/^#[0-9a-f]{6}$/i.test(candidate)) localHex = candidate.toLowerCase()
      else if (/^#[0-9a-f]{3}$/i.test(candidate)) localHex = `#${candidate.slice(1).split('').map((part) => `${part}${part}`).join('')}`.toLowerCase()
    } catch {
      localHex = undefined
    }
    return [key, { raw: String(raw), ...(value ? { hex: value.hex, luminance: value.luminance } : localHex ? { hex: localHex } : {}) }]
  }))
  const dimensions = (section: unknown, resolvedMap?: Record<string, { value: number; unit: string }>) => Object.fromEntries(
    Object.entries(isRecord(section) ? section : {}).map(([key, raw]) => {
      const value = resolvedMap?.[key]
      return [key, value ? { raw: String(raw), value: value.value, unit: value.unit } : rawDimension(raw)]
    })
  )
  const typography = Object.fromEntries(Object.entries(isRecord(root.typography) ? root.typography : {}).map(([key, raw]) => {
    const sourceValue = isRecord(raw) ? raw : {}
    const value = resolved?.typography[key]
    const localFontWeight = Number(sourceValue.fontWeight)
    return [key, {
      raw: sourceValue,
      ...(value?.fontFamily || typeof sourceValue.fontFamily === 'string' ? { fontFamily: value?.fontFamily ?? sourceValue.fontFamily as string } : {}),
      ...(value?.fontSize ? { fontSize: { raw: String(sourceValue.fontSize ?? ''), ...value.fontSize } } : sourceValue.fontSize !== undefined ? { fontSize: rawDimension(sourceValue.fontSize) } : {}),
      ...(value?.fontWeight ? { fontWeight: value.fontWeight } : Number.isFinite(localFontWeight) ? { fontWeight: localFontWeight } : {}),
      ...(value?.lineHeight ? { lineHeight: { raw: String(sourceValue.lineHeight ?? ''), ...value.lineHeight } } : sourceValue.lineHeight !== undefined ? { lineHeight: rawDimension(sourceValue.lineHeight) } : {}),
      ...(value?.letterSpacing ? { letterSpacing: { raw: String(sourceValue.letterSpacing ?? ''), ...value.letterSpacing } } : sourceValue.letterSpacing !== undefined ? { letterSpacing: rawDimension(sourceValue.letterSpacing) } : {})
    }]
  }))
  const components = Object.fromEntries(Object.entries(isRecord(root.components) ? root.components : {}).map(([key, value]) => [key, isRecord(value) ? value : { value }]))
  const extensions = Object.fromEntries(Object.entries(root).filter(([key]) => !KNOWN_KEYS.has(key)))
  const document: ProjectDesignMdDocument = {
    name: typeof root.name === 'string' ? root.name : 'Project design system',
    ...(typeof root.description === 'string' ? { description: root.description } : {}),
    colors,
    typography,
    rounded: dimensions(root.rounded, resolved?.rounded),
    spacing: dimensions(root.spacing, resolved?.spacing),
    components,
    extensions,
    sections,
    raw: content,
    sourceHash: projectDesignMdHash(content)
  }
  return { ok: !diagnostics.some((item) => item.severity === 'error'), document, diagnostics }
}

export async function parseProjectDesignMdWithOfficialLint(
  content: string,
  options?: { truncated?: boolean }
): Promise<ProjectDesignMdParseResult> {
  const local = parseProjectDesignMd(content, options)
  if (!local.document || typeof window === 'undefined' || typeof window.kunGui?.lintProjectDesignMd !== 'function') return local
  const officialLint = await window.kunGui.lintProjectDesignMd(content).catch((error: unknown): ProjectDesignMdOfficialLintResult => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  }))
  return parseProjectDesignMd(content, { ...options, officialLint })
}

export type DesignMdStructuredPatch = {
  section: 'colors' | 'typography' | 'rounded' | 'spacing' | 'components'
  key: string
  value: unknown | null
}

export function patchProjectDesignMd(content: string, patches: DesignMdStructuredPatch[]): ProjectDesignMdParseResult {
  const source = splitSource(content)
  if (!source) return parseProjectDesignMd(content)
  const document = parseDocument(source.yaml, { strict: true, uniqueKeys: true })
  for (const patch of patches) {
    if (patch.value === null) document.deleteIn([patch.section, patch.key])
    else document.setIn([patch.section, patch.key], patch.value)
  }
  const next = `---\n${document.toString().trimEnd()}\n---\n${source.markdown}`
  return parseProjectDesignMd(next)
}
