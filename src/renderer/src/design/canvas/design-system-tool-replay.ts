import type { OpError } from './shape-ops'
import { useProjectDesignSystemStore } from './project-design-system-store'
import { persistNativeDesignSystemToProjectDesignMd } from './use-project-design-system-sync'
import { useDesignWorkspaceStore } from '../design-workspace-store'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isDesignSystemCanvasTool(toolName: unknown): boolean {
  return toolName === 'design_system' || toolName === 'design_system_template'
}

export function designSystemToolRevisionError(toolName: unknown, payloadValue: unknown): OpError | null {
  if (!isDesignSystemCanvasTool(toolName)) return null
  const payload = isRecord(payloadValue) ? payloadValue : null
  const operation = typeof payload?.operation === 'string' ? payload.operation : 'update'
  if (operation === 'validate') return null
  const expectedHash = typeof payload?.expectedHash === 'string' ? payload.expectedHash : ''
  const currentHash = useProjectDesignSystemStore.getState().sourceHash
  if (!currentHash || expectedHash === currentHash) return null
  return {
    code: 'INVALID_OP',
    message: expectedHash
      ? 'DESIGN.md changed since this design_system call was prepared. Read the current file and retry with its exact source hash.'
      : 'design_system must include expectedHash when root DESIGN.md already exists.'
  }
}

export function persistAppliedDesignSystemTool(toolName: unknown, errors: readonly OpError[]): void {
  if (!isDesignSystemCanvasTool(toolName) || errors.length > 0) return
  const workspaceRoot = useDesignWorkspaceStore.getState().workspaceRoot
  if (!workspaceRoot) return
  void persistNativeDesignSystemToProjectDesignMd(workspaceRoot).then((ok) => {
    if (!ok) useDesignWorkspaceStore.getState().setFileError('Could not save root DESIGN.md.')
  })
}
