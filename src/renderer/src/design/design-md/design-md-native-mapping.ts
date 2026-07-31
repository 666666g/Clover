import type { DesignSystem, DesignToken } from '../canvas/design-system-types'
import type { ProjectDesignMdDocument } from './design-md-types'
import { patchProjectDesignMd } from './design-md-adapter'
import { stringify } from 'yaml'

function pixels(value: { value?: number; unit?: string }): number | null {
  if (!Number.isFinite(value.value)) return null
  if (!value.unit || value.unit === 'px') return value.value as number
  if (value.unit === 'rem') return (value.value as number) * 16
  return null
}

function nativeTokenPublicPath(name: string): { section: 'colors' | 'typography' | 'rounded' | 'spacing'; key: string } | null {
  const [group, ...restParts] = name.split('/')
  const rest = restParts.join('/')
  if (!rest) return null
  if (group === 'brand') return { section: 'colors', key: rest }
  if (group === 'surface') return { section: 'colors', key: rest === 'canvas' ? 'surface' : `surface-${rest}` }
  if (group === 'text') return { section: 'colors', key: rest === 'primary' ? 'on-surface' : `on-surface-${rest}` }
  if (group === 'border') return { section: 'colors', key: rest === 'default' ? 'outline' : `outline-${rest}` }
  if (group === 'type') return { section: 'typography', key: rest }
  if (group === 'space') return { section: 'spacing', key: rest }
  if (group === 'radius') return { section: 'rounded', key: rest }
  return null
}

export function designMdTokenForNativeName(document: ProjectDesignMdDocument, name: string): DesignToken | null {
  const dotted = /^(colors|typography|rounded|spacing)\.(.+)$/.exec(name)
  const path = dotted
    ? { section: dotted[1] as 'colors' | 'typography' | 'rounded' | 'spacing', key: dotted[2] }
    : nativeTokenPublicPath(name)
  if (!path) return null
  if (path.section === 'colors') {
    const value = document.colors[path.key]?.hex
    return value ? { name, kind: 'color', value } : null
  }
  if (path.section === 'spacing' || path.section === 'rounded') {
    const value = pixels(document[path.section][path.key] ?? {})
    if (value === null) return null
    return { name, kind: path.section === 'spacing' ? 'space' : 'radius', value }
  }
  const value = document.typography[path.key]
  if (!value) return null
  const fontSize = value.fontSize ? pixels(value.fontSize) : null
  const lineHeight = value.lineHeight ? pixels(value.lineHeight) : null
  return { name, kind: 'type', value: {
    ...(value.fontFamily ? { fontFamily: value.fontFamily } : {}),
    ...(fontSize !== null ? { fontSize } : {}),
    ...(value.fontWeight ? { fontWeight: value.fontWeight } : {}),
    ...(lineHeight !== null ? { lineHeight } : {})
  } }
}

/** Maps compatible public tokens only. Rich internal component trees are preserved. */
export function mapProjectDesignMdToNative(
  document: ProjectDesignMdDocument,
  current: DesignSystem
): DesignSystem {
  const tokens: Record<string, DesignToken> = Object.fromEntries(
    Object.entries(current.tokens).filter(([name]) => !/^(colors|spacing|rounded|typography)\./.test(name))
  )
  for (const [name, color] of Object.entries(document.colors)) {
    if (color.hex) tokens[`colors.${name}`] = { name: `colors.${name}`, kind: 'color', value: color.hex }
  }
  for (const [name, value] of Object.entries(document.spacing)) {
    const numeric = pixels(value)
    if (numeric !== null) tokens[`spacing.${name}`] = { name: `spacing.${name}`, kind: 'space', value: numeric }
  }
  for (const [name, value] of Object.entries(document.rounded)) {
    const numeric = pixels(value)
    if (numeric !== null) tokens[`rounded.${name}`] = { name: `rounded.${name}`, kind: 'radius', value: numeric }
  }
  for (const [name, value] of Object.entries(document.typography)) {
    const fontSize = value.fontSize ? pixels(value.fontSize) : null
    const lineHeight = value.lineHeight ? pixels(value.lineHeight) : null
    tokens[`typography.${name}`] = {
      name: `typography.${name}`,
      kind: 'type',
      value: {
        ...(value.fontFamily ? { fontFamily: value.fontFamily } : {}),
        ...(fontSize !== null ? { fontSize } : {}),
        ...(value.fontWeight ? { fontWeight: value.fontWeight } : {}),
        ...(lineHeight !== null ? { lineHeight } : {})
      }
    }
  }
  for (const name of Object.keys(current.tokens)) {
    if (name.includes('/')) {
      const alias = designMdTokenForNativeName(document, name)
      if (alias) tokens[name] = alias
    }
  }
  return { tokens, components: current.components }
}

export function removeProjectDesignMdNativeTokens(current: DesignSystem): DesignSystem {
  return {
    tokens: Object.fromEntries(Object.entries(current.tokens).filter(([name]) => !/^(colors|spacing|rounded|typography)\./.test(name))),
    components: current.components
  }
}

export function serializeNativeDesignSystemAsDesignMd(
  system: DesignSystem,
  current?: ProjectDesignMdDocument | null,
  name = 'Project design system'
): string {
  const sections = { colors: {}, typography: {}, rounded: {}, spacing: {}, components: {} } as Record<string, Record<string, unknown>>
  for (const token of Object.values(system.tokens)) {
    const dotted = /^(colors|typography|rounded|spacing)\.(.+)$/.exec(token.name)
    const path = dotted
      ? { section: dotted[1], key: dotted[2] }
      : nativeTokenPublicPath(token.name)
    const key = path?.key ?? token.name.replaceAll('/', '-')
    if (token.kind === 'color') sections.colors[key] = token.value
    else if (token.kind === 'space') sections.spacing[key] = `${token.value}px`
    else if (token.kind === 'radius') sections.rounded[key] = `${token.value}px`
    else if (token.kind === 'type') sections.typography[key] = {
      ...(token.value.fontFamily ? { fontFamily: token.value.fontFamily } : {}),
      ...(token.value.fontSize ? { fontSize: `${token.value.fontSize}px` } : {}),
      ...(token.value.fontWeight ? { fontWeight: String(token.value.fontWeight) } : {}),
      ...(token.value.lineHeight ? { lineHeight: `${token.value.lineHeight}px` } : {})
    }
  }
  if (!current) return `---\n${stringify({ name, ...sections }).trimEnd()}\n---\n# Brand & Style\n\nProject design system managed by Kun.\n\n# Colors\n\nUse semantic color roles consistently.\n\n# Typography\n\nUse the defined hierarchy consistently.\n`
  const patches = Object.entries(sections).flatMap(([section, values]) => Object.entries(values).map(([key, value]) => ({ section: section as 'colors' | 'typography' | 'rounded' | 'spacing' | 'components', key, value })))
  return patchProjectDesignMd(current.raw, patches).document?.raw ?? current.raw
}
