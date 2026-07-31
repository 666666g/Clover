import { z } from 'zod'
import { ExtensionIdSchema, LocalIdSchema, SemverSchema } from './common.js'

/**
 * Stable Host-owned bridge exposed to a declared `hostContentScripts`
 * contribution. Raw DOM selectors remain outside Extension API compatibility;
 * this small bridge does not.
 */
export const HostContentScriptContextSchema = z.strictObject({
  apiVersion: z.literal(1),
  extensionId: ExtensionIdSchema,
  extensionVersion: SemverSchema,
  contributionId: LocalIdSchema,
  surface: z.enum([
    'workbench:code',
    'workbench:design',
    'workbench:write',
    'workbench:connect'
  ]),
  runAt: z.enum(['documentStart', 'documentEnd']),
  workspaceScope: z.string().min(1).max(128),
  marker: z.string().min(3).max(256),
  rawDomCompatibility: z.literal('unsupported')
})
export type HostContentScriptContext = z.infer<typeof HostContentScriptContextSchema>

export const HostContentScriptDiagnosticSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  message: z.string().trim().min(1).max(2_000),
  level: z.enum(['info', 'warning', 'error']).default('warning')
})
export type HostContentScriptDiagnostic = z.input<typeof HostContentScriptDiagnosticSchema>

export interface KunHostContentScriptApi {
  /** Returns immutable identity/surface metadata derived by Kun, never by the script. */
  getContext(): HostContentScriptContext
  /** Emits one bounded, extension-attributed diagnostic through Electron Main. */
  reportDiagnostic(diagnostic: HostContentScriptDiagnostic): Promise<void>
  /** Disposes this page-local bridge and emits the deactivation event once. */
  dispose(): void
}
