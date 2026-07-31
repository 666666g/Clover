import type { CanvasShape } from './canvas-types'
import type {
  ComponentDef,
  ComponentVariant,
  ComponentVariantAxis,
  DesignSystem,
  DesignToken
} from './design-system-types'
import { LEGACY_PROJECT_DESIGN_SYSTEM_PATH } from '../design-md/design-md-paths'

/** @deprecated Legacy migration sidecar. Root DESIGN.md is the only public project theme. */
export const PROJECT_DESIGN_SYSTEM_PATH = LEGACY_PROJECT_DESIGN_SYSTEM_PATH
export const PROJECT_DESIGN_SYSTEM_SCHEMA_VERSION = 1 as const

export type ProjectDesignSystemV1 = {
  schemaVersion: typeof PROJECT_DESIGN_SYSTEM_SCHEMA_VERSION
  meta: {
    id: string
    name: string
    description?: string
    updatedAt: string
  }
  tokens: Record<string, DesignToken>
  components: Record<string, ComponentDef>
}

export type ProjectDesignSystemParseResult =
  | { ok: true; document: ProjectDesignSystemV1 }
  | { ok: false; errors: string[] }

const TOKEN_KINDS = new Set(['color', 'gradient', 'type', 'space', 'radius', 'shadow'])
const SHAPE_TYPES = new Set(['rect', 'ellipse', 'text', 'image', 'frame', 'group', 'arrow', 'line', 'draw'])
const SLOT_KINDS = new Set(['text', 'image', 'color', 'visible'])
const FORBIDDEN_COMPONENT_FIELDS = new Set([
  'htmlArtifactId',
  'embeddedArtifact',
  'runningApp',
  'agentNote'
])
const FORBIDDEN_VARIANT_FIELDS = new Set([
  'id',
  'type',
  'name',
  'parentId',
  'frameId',
  'children',
  'componentId',
  'componentVersion',
  'htmlArtifactId',
  'embeddedArtifact',
  'runningApp',
  'agentNote'
])

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validToken(value: unknown): value is DesignToken {
  if (!record(value) || typeof value.name !== 'string' || typeof value.kind !== 'string') return false
  if (!TOKEN_KINDS.has(value.kind) || !('value' in value)) return false
  if (value.kind === 'color') return typeof value.value === 'string'
  if (value.kind === 'space' || value.kind === 'radius') return typeof value.value === 'number' && Number.isFinite(value.value)
  if (value.kind === 'shadow') return Array.isArray(value.value)
  return record(value.value)
}

function validShape(value: unknown): value is CanvasShape {
  if (!record(value)) return false
  if (Object.keys(value).some((key) => FORBIDDEN_COMPONENT_FIELDS.has(key))) return false
  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    SHAPE_TYPES.has(value.type) &&
    typeof value.name === 'string' &&
    (value.parentId === null || typeof value.parentId === 'string') &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    Array.isArray(value.children) &&
    value.children.every((item) => typeof item === 'string')
  )
}

function validVariantAxis(value: unknown): value is ComponentVariantAxis {
  return record(value) &&
    Array.isArray(value.values) &&
    value.values.length > 0 &&
    value.values.every((item) => typeof item === 'string' && item.length > 0) &&
    typeof value.defaultValue === 'string' &&
    value.values.includes(value.defaultValue)
}

function validVariant(value: unknown, shapeIds: ReadonlySet<string>): value is ComponentVariant {
  if (!record(value) || !record(value.selection) || !record(value.overrides)) return false
  if (!Object.values(value.selection).every((item) => typeof item === 'string')) return false
  return Object.entries(value.overrides).every(([shapeId, override]) =>
    shapeIds.has(shapeId) &&
    record(override) &&
    !Object.keys(override).some((key) => FORBIDDEN_VARIANT_FIELDS.has(key))
  )
}

function validComponent(value: unknown): value is ComponentDef {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return false
  if (typeof value.version !== 'number' || !Array.isArray(value.tree) || value.tree.length === 0) return false
  if (!value.tree.every(validShape) || !Array.isArray(value.slots)) return false
  if (!value.slots.every((slot) => record(slot) && typeof slot.path === 'string' && typeof slot.kind === 'string' && SLOT_KINDS.has(slot.kind))) return false
  const shapeIds = new Set((value.tree as CanvasShape[]).map((shape) => shape.id))
  if (shapeIds.size !== value.tree.length || (value.tree[0] as CanvasShape).x !== 0 || (value.tree[0] as CanvasShape).y !== 0) return false
  if (value.variantAxes !== undefined && (!record(value.variantAxes) || !Object.values(value.variantAxes).every(validVariantAxis))) return false
  if (value.variants !== undefined && (!record(value.variants) || !Object.values(value.variants).every((variant) => validVariant(variant, shapeIds)))) return false
  return true
}

function parseEntries<T>(value: unknown, validate: (entry: unknown) => entry is T): Record<string, T> | null {
  if (!record(value)) return null
  const out: Record<string, T> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!validate(entry)) return null
    out[key] = entry
  }
  return out
}

export function parseProjectDesignSystem(raw: string): ProjectDesignSystemParseResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'Invalid JSON'] }
  }
  if (!record(value)) return { ok: false, errors: ['Design system must be a JSON object.'] }
  if (value.schemaVersion !== PROJECT_DESIGN_SYSTEM_SCHEMA_VERSION) {
    return { ok: false, errors: [`Unsupported schemaVersion: ${String(value.schemaVersion)}`] }
  }
  if (!record(value.meta) || typeof value.meta.id !== 'string' || typeof value.meta.name !== 'string' || typeof value.meta.updatedAt !== 'string') {
    return { ok: false, errors: ['meta.id, meta.name, and meta.updatedAt are required strings.'] }
  }
  const tokens = parseEntries(value.tokens, validToken)
  if (!tokens) return { ok: false, errors: ['tokens contains an invalid token.'] }
  const components = parseEntries(value.components, validComponent)
  if (!components) return { ok: false, errors: ['components contains an invalid component tree or variant.'] }
  return {
    ok: true,
    document: {
      schemaVersion: 1,
      meta: {
        id: value.meta.id,
        name: value.meta.name,
        ...(typeof value.meta.description === 'string' ? { description: value.meta.description } : {}),
        updatedAt: value.meta.updatedAt
      },
      tokens,
      components
    }
  }
}

export function createProjectDesignSystem(name = 'Project design system'): ProjectDesignSystemV1 {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
  return {
    schemaVersion: 1,
    meta: { id: `design-system-${slug}`, name: name.trim() || 'Project design system', updatedAt: new Date().toISOString() },
    tokens: {},
    components: {}
  }
}

export function projectDesignSystemFromSystem(
  system: DesignSystem,
  current?: ProjectDesignSystemV1 | null
): ProjectDesignSystemV1 {
  const base = current ?? createProjectDesignSystem()
  return {
    ...base,
    meta: { ...base.meta, updatedAt: new Date().toISOString() },
    tokens: system.tokens,
    components: system.components
  }
}

export function serializeProjectDesignSystem(document: ProjectDesignSystemV1): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function projectDesignSystemHash(content: string): string {
  let hash = 5381
  for (let index = 0; index < content.length; index += 1) hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0
  return (hash >>> 0).toString(36)
}
