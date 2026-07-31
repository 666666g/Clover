import {
  currentDesignArtifactVersion,
  designArtifactVersionLabel,
  type DesignArtifact
} from './design-types'
import { formatDesignContextLines, type DesignContext } from './design-context'

type SelectedContextLine = {
  kind?: string
  label: string
  detail?: string
}

export type BuildDesignArtifactMarkdownOptions = {
  artifact: DesignArtifact
  designMdPath: string
  currentTurn: string
  designContext?: DesignContext
  selectedContext?: readonly SelectedContextLine[]
  updatedAt?: string
}

function fallback(value: string | undefined, empty = 'TBD'): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : empty
}

function originalBrief(artifact: DesignArtifact): string {
  return fallback(artifact.versions[artifact.versions.length - 1]?.summary, artifact.title)
}

function currentVersionLabel(artifact: DesignArtifact): string {
  return designArtifactVersionLabel(currentDesignArtifactVersion(artifact), Math.max(1, artifact.versions.length))
}

function formatSelectedContext(context: readonly SelectedContextLine[] | undefined): string {
  if (!context || context.length === 0) return '- None'
  return context
    .map((item) => {
      const prefix = item.kind ? `[${item.kind}] ` : ''
      const detail = item.detail ? ` - ${item.detail}` : ''
      return `- ${prefix}${fallback(item.label, 'Selection')}${detail}`
    })
    .join('\n')
}

function formatPersistedDesignContext(ctx: DesignContext | undefined): string {
  const lines = formatDesignContextLines(ctx).map((line) => line.trimEnd())
  return lines.length > 0 ? lines.join('\n') : '- Target: Web'
}

export function buildDesignArtifactMarkdown(options: BuildDesignArtifactMarkdownOptions): string {
  const { artifact, designMdPath, currentTurn } = options
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  const currentVersion = currentDesignArtifactVersion(artifact)
  const isSvg = artifact.kind === 'svg'
  const sourceLabel = isSvg ? 'Source SVG path' : 'Source HTML path'
  const visualDirection = isSvg
    ? [
        '- Define the vector composition, layer hierarchy, palette, stroke/fill treatment, and static first frame.',
        '- Preserve a responsive viewBox and keep editable visual layers on stable descriptive ids.',
        '- Keep visual decisions consistent with root `DESIGN.md` when that valid project theme exists.'
      ]
    : [
        '- Establish the page layout, hierarchy, color system, typography, spacing, and responsive behavior for this screen.',
        '- Keep visual decisions consistent with root `DESIGN.md` when that valid project theme exists.'
      ]
  const interactionNotes = isSvg
    ? '- Document animation timing, easing, loop behavior, paused/reduced-motion behavior, and accessibility metadata here as the design evolves.'
    : '- Document important states, inputs, navigation, animation, and accessibility behavior here as the design evolves.'
  const handoffNotes = isSvg
    ? [
        '- Keep the SVG file standalone, script-free, and implementation-ready.',
        '- Preserve its viewBox, stable element ids, accessible title/description, and declarative animation when implementing it.',
        '- Note any assumptions or follow-up work that code mode should preserve.'
      ]
    : [
        '- Keep the HTML file standalone and implementation-ready.',
        '- Note any assumptions or follow-up work that code mode should preserve.'
      ]
  const versionRows =
    artifact.versions.length > 0
      ? artifact.versions
          .map((version, index) => {
            const label = designArtifactVersionLabel(version, Math.max(1, artifact.versions.length - index))
            return `- ${label}: \`${version.relativePath}\` - ${fallback(version.summary, 'No summary')}`
          })
          .join('\n')
      : '- v1: No version history yet'

  return `# Design Notes: ${fallback(artifact.title, artifact.id)}

- Artifact id: \`${artifact.id}\`
- ${sourceLabel}: \`${artifact.relativePath}\`
- Design notes file: \`${designMdPath}\`
- Current version: ${currentVersionLabel(artifact)}${currentVersion ? ` (\`${currentVersion.relativePath}\`)` : ''}
- Updated: ${updatedAt}

## Original Brief

${originalBrief(artifact)}

## Current User Turn

${fallback(currentTurn, 'No current turn recorded.')}

## Selected Context

${formatSelectedContext(options.selectedContext)}

## Design Context

${formatPersistedDesignContext(options.designContext)}

## Visual Direction

${visualDirection.join('\n')}

## Interaction Notes

${interactionNotes}

## Handoff Notes

${handoffNotes.join('\n')}

## Version History

${versionRows}
`
}
