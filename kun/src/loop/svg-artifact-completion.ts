import type { TurnItem } from '../contracts/items.js'
import {
  DESIGN_SVG_ANIMATE_TOOL_NAME,
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
} from '../adapters/tool/design-svg-tool.js'

export type SvgArtifactCompletionState = {
  mutationSucceeded: boolean
  validationAfterMutation: boolean
  mutationRevision?: string
  validationRevision?: string
}

/**
 * Dedicated SVG turns are not complete until a structured mutation succeeded
 * and a later validation succeeded. A validation before the last mutation is
 * stale and must not satisfy the gate.
 */
export function svgArtifactCompletionState(
  items: readonly TurnItem[],
  turnId: string
): SvgArtifactCompletionState {
  let lastMutation = -1
  let lastValidation = -1
  let mutationRevision = ''
  let validationRevision = ''
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (
      item?.turnId !== turnId ||
      item.kind !== 'tool_result' ||
      item.status !== 'completed' ||
      item.isError === true
    ) continue
    const output = item.output && typeof item.output === 'object' && !Array.isArray(item.output)
      ? item.output as Record<string, unknown>
      : null
    const revision = typeof output?.revision === 'string' ? output.revision : ''
    if (output?.ok !== true || !revision) continue
    if (item.toolName === DESIGN_SVG_EDIT_TOOL_NAME || item.toolName === DESIGN_SVG_ANIMATE_TOOL_NAME) {
      lastMutation = index
      mutationRevision = revision
    } else if (item.toolName === DESIGN_SVG_VALIDATE_TOOL_NAME) {
      lastValidation = index
      validationRevision = revision
    }
  }
  return {
    mutationSucceeded: lastMutation >= 0,
    validationAfterMutation:
      lastMutation >= 0 &&
      lastValidation > lastMutation &&
      validationRevision === mutationRevision,
    ...(mutationRevision ? { mutationRevision } : {}),
    ...(validationRevision ? { validationRevision } : {})
  }
}
