import { z } from 'zod'
import { ExtensionIdSchema, SemverSchema } from './common.js'
import { PermissionSchema } from './permissions.js'

export const ExtensionSourceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('local'), path: z.string().min(1).max(4096) }),
  z.strictObject({ type: z.literal('development'), path: z.string().min(1).max(4096) }),
  z.strictObject({
    type: z.literal('index'),
    indexUrl: z.string().url(),
    packageUrl: z.string().url()
  })
])
export type ExtensionSource = z.infer<typeof ExtensionSourceSchema>

export const SignatureStatusSchema = z.enum(['unsigned', 'valid', 'invalid', 'unknown-key'])
export type SignatureStatus = z.infer<typeof SignatureStatusSchema>

export const InstalledExtensionVersionSchema = z.strictObject({
  version: SemverSchema,
  path: z.string().min(1).max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: ExtensionSourceSchema,
  signatureStatus: SignatureStatusSchema,
  installedAt: z.string().datetime(),
  permissions: z.array(PermissionSchema),
  apiVersion: SemverSchema,
  manifestVersion: z.number().int().positive(),
  stateSchemaVersion: z.number().int().nonnegative(),
  mutable: z.boolean().default(false)
})
export type InstalledExtensionVersion = z.infer<typeof InstalledExtensionVersionSchema>

export const PermissionGrantSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  version: SemverSchema,
  permissions: z.array(PermissionSchema),
  acceptedAt: z.string().datetime(),
  workspaceId: z.string().min(1).max(256).optional()
})
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>

export const ExtensionRegistryEntrySchema = z.strictObject({
  id: ExtensionIdSchema,
  selectedVersion: SemverSchema.optional(),
  previousVersion: SemverSchema.optional(),
  installedVersions: z.array(InstalledExtensionVersionSchema),
  enabled: z.boolean(),
  workspaceEnablement: z.record(z.string().min(1).max(256), z.boolean()).default({}),
  grants: z.array(PermissionGrantSchema).default([]),
  unavailableReason: z.string().max(4096).optional()
})
export type ExtensionRegistryEntry = z.infer<typeof ExtensionRegistryEntrySchema>

export const ExtensionRegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  extensions: z.record(ExtensionIdSchema, ExtensionRegistryEntrySchema),
  updatedAt: z.string().datetime()
})
export type ExtensionRegistry = z.infer<typeof ExtensionRegistrySchema>
