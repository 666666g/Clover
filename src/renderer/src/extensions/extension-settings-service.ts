import type { JsonValue } from '@kun/extension-api'

/**
 * Renderer-facing contract for the authenticated declarative settings broker.
 *
 * There is deliberately no localStorage implementation: host content scripts
 * share the Kun document origin, so renderer-origin storage cannot isolate one
 * extension's configuration from another extension. Main/Kun must derive the
 * owner from the qualified contribution ID, revalidate the manifest property
 * schema and scope, and persist into the extension's global/workspace state.
 */
export type ExtensionSettingsSnapshot = {
  schemaVersion: 1
  revision: number
  values: Record<string, Record<string, JsonValue>>
}

export type ExtensionSettingsLoadRequest = {
  contributionIds: string[]
  workspaceRoot?: string
}

export type ExtensionSettingUpdateRequest = {
  contributionId: string
  key: string
  value: JsonValue
  expectedRevision: number
  workspaceRoot?: string
}

export type ExtensionSettingChange = {
  schemaVersion: 1
  revision: number
  contributionId: string
  key: string
  value: JsonValue
  scope: 'global' | 'workspace'
  workspaceRoot?: string
}

export interface ExtensionSettingsService {
  load(request: ExtensionSettingsLoadRequest): Promise<ExtensionSettingsSnapshot>
  update(request: ExtensionSettingUpdateRequest): Promise<ExtensionSettingsSnapshot>
  subscribe?(listener: (change: ExtensionSettingChange) => void): () => void
}
