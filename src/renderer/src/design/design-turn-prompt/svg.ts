import { WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines } from '../design-context'
import type { DesignTurnOptions } from './shared'
import { formatContextLocationLines } from './shared'
import { formatProjectDesignSystemLines } from './html-and-canvas'

export function buildSvgTurnPrompt(options: DesignTurnOptions): string {
  const lines = [
    options.basePath
      ? 'Kun is asking you to ITERATE on an existing standalone SVG motion artifact.'
      : 'Kun is asking you to create a standalone SVG or SVG-motion artifact.',
    `Workspace: ${options.workspaceRoot}`,
    `Reserved SVG file: ${options.artifactRelativePath}`,
    ...(options.basePath ? [`Previous version to preserve and improve: ${options.basePath}`] : []),
    ...(options.designNotesPath ? [`Design notes file: ${options.designNotesPath}`] : []),
    ...formatProjectDesignSystemLines(options),
    '',
    'Use the structured SVG tools; do not write raw XML with Write/Edit:',
    '- Start with `design_svg_inspect` to see the current element ids and animations.',
    '- Use `design_svg_edit` with one focused batch to add/update/delete/reparent vector elements and defs.',
    '- Use `design_svg_animate` for attribute, transform, motion-path, and path-draw animation.',
    '- Finish with `design_svg_validate`; fix every error before completing.',
    '',
    'SVG requirements:',
    '- Keep the document standalone, responsive through viewBox, and visually complete at its static first frame.',
    '- Give every editable visual layer a stable descriptive id. Reuse existing ids when iterating.',
    '- Include an accessible <title> and <desc>. Use groups for semantic layers and defs for shared gradients, masks, filters, markers, and symbols.',
    '- Use declarative SVG animation only. Never add scripts, event-handler attributes, foreignObject, external URLs, or network-loaded assets.',
    '- Prefer a small coordinated timeline over many unrelated infinite effects. Motion should communicate hierarchy and remain readable when paused.',
    '- For animated logos/icons/loaders, preserve crisp vector geometry and transparent-background usability.',
    '- Do not create an HTML page, raster image, or ShapeOps recreation of this SVG artifact.',
    '',
    'Animation tool examples:',
    '- transform: { "targetId": "mark", "kind": "transform", "transformType": "rotate", "from": "0 64 64", "to": "360 64 64", "durationMs": 1200, "iterations": "infinite" }',
    '- fade: { "targetId": "label", "kind": "attribute", "attributeName": "opacity", "values": [0,1], "durationMs": 500 }',
    '- path draw: { "targetId": "logo-path", "kind": "path-draw", "durationMs": 900 }'
  ]
  const contextLines = formatContextLocationLines(options.contextLocations)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  const designContext = formatDesignContextLines(options.designContext)
  if (designContext.length > 0) lines.push('', ...designContext)
  lines.push('', ...DESIGN_CRAFT_LINES.slice(0, 5))
  const brief = options.text?.trim()
  if (brief) lines.push('', 'Brief:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  return lines.join('\n')
}
