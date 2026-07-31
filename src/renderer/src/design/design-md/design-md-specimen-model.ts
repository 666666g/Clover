import type { DesignMdColor, ProjectDesignMdDocument } from './design-md-types'

export type DesignMdSpecimenPalette = {
  name: string
  color: DesignMdColor
  featured: boolean
}

export type DesignMdSpecimenModel = {
  name: string
  palettes: DesignMdSpecimenPalette[]
  typographyNames: string[]
  surface: string
  onSurface: string
  primary: string
  secondary: string
}

const FEATURED_ROLE_GROUPS = [
  ['primary'],
  ['secondary'],
  ['tertiary'],
  ['neutral', 'surface', 'background']
] as const

export function readableDesignMdTextColor(hex: string): string {
  const value = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#111827'
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#111827' : '#ffffff'
}

function resolvedColor(document: ProjectDesignMdDocument, name: string | undefined): string | undefined {
  if (!name) return undefined
  return document.colors[name]?.hex
}

export function buildDesignMdSpecimenModel(document: ProjectDesignMdDocument): DesignMdSpecimenModel {
  const names = Object.keys(document.colors)
  const featuredNames = FEATURED_ROLE_GROUPS.map((group, index) =>
    group.find((name) => names.includes(name)) ?? names[index]
  ).filter((name, index, all): name is string => Boolean(name) && all.indexOf(name) === index)
  const supplementalNames = names.filter((name) => !featuredNames.includes(name)).sort((a, b) => a.localeCompare(b))
  const paletteNames = [...featuredNames, ...supplementalNames]
  const surface = resolvedColor(document, names.includes('surface') ? 'surface' : names.includes('background') ? 'background' : featuredNames[3]) ?? '#131313'
  return {
    name: document.name,
    palettes: paletteNames.map((name) => ({ name, color: document.colors[name], featured: featuredNames.includes(name) })),
    typographyNames: Object.keys(document.typography).sort((a, b) => a.localeCompare(b)),
    surface,
    onSurface: resolvedColor(document, 'on-surface') ?? readableDesignMdTextColor(surface),
    primary: resolvedColor(document, 'primary') ?? resolvedColor(document, featuredNames[0]) ?? '#e5e7eb',
    secondary: resolvedColor(document, 'secondary') ?? resolvedColor(document, featuredNames[1]) ?? '#d4af37'
  }
}
