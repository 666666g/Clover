import { parseProjectDesignSystem } from '../canvas/project-design-system'
import { serializeNativeDesignSystemAsDesignMd } from './design-md-native-mapping'
import { saveProjectDesignMd } from '../canvas/use-project-design-system-sync'

export type LegacyDesignSystemMigrationDraft = {
  content: string
  tokenCount: number
  preservedComponentNames: string[]
  notes: string[]
}

/** Converts without writing or deleting either source. Rich component trees remain in the legacy sidecar. */
export function createLegacyDesignSystemMigrationDraft(raw: string): LegacyDesignSystemMigrationDraft | null {
  const parsed = parseProjectDesignSystem(raw)
  if (!parsed.ok) return null
  const componentNames = Object.values(parsed.document.components).map((component) => component.name).sort((a, b) => a.localeCompare(b))
  const base = serializeNativeDesignSystemAsDesignMd({
    tokens: parsed.document.tokens,
    components: parsed.document.components
  }, null, parsed.document.meta.name)
  const notes = [
    'Migrated from `.kun-design/design-system.json`.',
    'The legacy file was not modified or deleted.',
    componentNames.length
      ? `Rich Kun component trees remain in the legacy sidecar: ${componentNames.join(', ')}.`
      : 'No rich Kun component trees were present.'
  ]
  return {
    content: `${base.trimEnd()}\n\n## Migration Notes\n\n${notes.map((note) => `- ${note}`).join('\n')}\n`,
    tokenCount: Object.keys(parsed.document.tokens).length,
    preservedComponentNames: componentNames,
    notes
  }
}

/** Must be called only after a user-facing migration confirmation. The legacy source is never deleted. */
export async function acceptLegacyDesignSystemMigration(
  workspaceRoot: string,
  raw: string
): Promise<LegacyDesignSystemMigrationDraft | null> {
  const draft = createLegacyDesignSystemMigrationDraft(raw)
  if (!draft) return null
  const saved = await saveProjectDesignMd(workspaceRoot, draft.content, '')
  return saved ? draft : null
}
