import { z } from 'zod'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.json() as z.ZodType<JsonValue>
export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema
) as z.ZodType<JsonObject>

export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export const SemverSchema = z.string().regex(SEMVER_PATTERN, 'Expected a valid SemVer version')
export const SemverRangeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[0-9A-Za-z.*+<>=~^| -]+$/, 'Expected a valid SemVer range expression')

export const LocalIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Expected a lowercase local identifier')
export const PublisherSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Expected a lowercase publisher identifier')
export const ExtensionNameSchema = LocalIdSchema
export const ExtensionIdSchema = z
  .string()
  .min(3)
  .max(129)
  .regex(/^[a-z0-9][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'Expected publisher.name')
export const ContributionIdSchema = z.union([
  z.string().regex(/^builtin:[a-z][a-z0-9-]*$/),
  z.string().regex(/^extension:[a-z0-9][a-z0-9-]*\.[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
])
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/,
    'Expected a normalized package-relative path using forward slashes'
  )

export const ExtensionIdentitySchema = z.strictObject({
  id: ExtensionIdSchema,
  publisher: PublisherSchema,
  name: ExtensionNameSchema,
  version: SemverSchema
})
export type ExtensionIdentity = z.infer<typeof ExtensionIdentitySchema>

export const PageRequestSchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(200).default(50)
})
export type PageRequest = z.input<typeof PageRequestSchema>

export const PageInfoSchema = z.strictObject({
  nextCursor: z.string().min(1).max(512).optional(),
  hasMore: z.boolean()
})
export type PageInfo = z.infer<typeof PageInfoSchema>

export function extensionIdOf(identity: Pick<ExtensionIdentity, 'publisher' | 'name'>): string {
  return `${identity.publisher}.${identity.name}`
}

export function qualifiedContributionId(extensionId: string, localId: string): string {
  return `extension:${ExtensionIdSchema.parse(extensionId)}/${LocalIdSchema.parse(localId)}`
}
