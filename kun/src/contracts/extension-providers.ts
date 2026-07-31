import { z } from 'zod'

export const ExtensionProviderAuthTypeSchema = z.enum(['api-key', 'oauth-pkce', 'oauth-device'])
export type ExtensionProviderAuthType = z.infer<typeof ExtensionProviderAuthTypeSchema>

export const ExtensionAccountStatusSchema = z.enum([
  'connected',
  'expired',
  'interaction-required',
  'error',
  'unavailable'
])
export type ExtensionAccountStatus = z.infer<typeof ExtensionAccountStatusSchema>

const HttpsUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
}, { message: 'provider endpoint must use HTTPS (loopback HTTP is allowed for development)' })

export const ExtensionOAuthPkceConfigSchema = z.object({
  authorizationUrl: HttpsUrlSchema,
  tokenUrl: HttpsUrlSchema,
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([]),
  redirectUri: z.string().url(),
  extraAuthorizationParams: z.record(z.string(), z.string()).optional()
})

export const ExtensionOAuthDeviceConfigSchema = z.object({
  deviceAuthorizationUrl: HttpsUrlSchema,
  tokenUrl: HttpsUrlSchema,
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([])
})

export const ExtensionProviderDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:/-]{1,191}$/i),
  ownerExtensionId: z.string().min(1),
  ownerExtensionVersion: z.string().min(1),
  displayName: z.string().min(1).max(200),
  description: z.string().max(4_000).optional(),
  authenticationProviderId: z.string().min(1).max(129).optional(),
  authenticationScopes: z.array(z.string().min(1).max(256)).max(128).default([]),
  credentialHosts: z.array(z.string().regex(
    /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
  )).max(64).default([]),
  authTypes: z.array(ExtensionProviderAuthTypeSchema).min(1),
  apiKey: z.object({
    headerName: z.string().min(1).default('Authorization'),
    prefix: z.string().default('Bearer ')
  }).optional(),
  oauthPkce: ExtensionOAuthPkceConfigSchema.optional(),
  oauthDevice: ExtensionOAuthDeviceConfigSchema.optional(),
  capabilities: z.object({
    streaming: z.boolean().default(true),
    toolCalls: z.boolean().default(true),
    reasoning: z.boolean().default(false),
    images: z.boolean().default(false),
    documents: z.boolean().default(false),
    tokenCounting: z.boolean().default(false)
  }),
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine((value, ctx) => {
  if (value.authTypes.includes('oauth-pkce') && !value.oauthPkce) {
    ctx.addIssue({ code: 'custom', path: ['oauthPkce'], message: 'oauthPkce config is required' })
  }
  if (value.authTypes.includes('oauth-device') && !value.oauthDevice) {
    ctx.addIssue({ code: 'custom', path: ['oauthDevice'], message: 'oauthDevice config is required' })
  }
})
export type ExtensionProviderDefinition = z.infer<typeof ExtensionProviderDefinitionSchema>

export const ExtensionAccountRecordSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  ownerExtensionId: z.string().min(1),
  label: z.string().min(1).max(200),
  authType: ExtensionProviderAuthTypeSchema,
  status: ExtensionAccountStatusSchema,
  credentialRef: z.string().min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ExtensionAccountRecord = z.infer<typeof ExtensionAccountRecordSchema>

export const ExtensionAccountProjectionSchema = ExtensionAccountRecordSchema.omit({ credentialRef: true })
export type ExtensionAccountProjection = z.infer<typeof ExtensionAccountProjectionSchema>

export const ExtensionProviderBindingSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1).optional(),
  modelId: z.string().min(1)
})
export type ExtensionProviderBinding = z.infer<typeof ExtensionProviderBindingSchema>

export const ExtensionProviderDataCategorySchema = z.enum([
  'conversation-history',
  'system-and-mode-instructions',
  'attachments',
  'tool-schemas'
])
export type ExtensionProviderDataCategory = z.infer<typeof ExtensionProviderDataCategorySchema>

/**
 * A user-reviewed provider/account/model tuple. This record intentionally
 * contains only opaque account identity and reviewed disclosure metadata.
 */
export const ExtensionProviderBindingRecordSchema = z.object({
  scopeKey: z.string().min(1).max(256),
  ownerExtensionId: z.string().min(1),
  ownerExtensionVersion: z.string().min(1),
  binding: ExtensionProviderBindingSchema.extend({ accountId: z.string().min(1) }),
  dataAccessDigest: z.string().regex(/^[a-f0-9]{64}$/),
  dataCategories: z.array(ExtensionProviderDataCategorySchema).min(1),
  acknowledgedAt: z.string(),
  updatedAt: z.string()
})
export type ExtensionProviderBindingRecord = z.infer<typeof ExtensionProviderBindingRecordSchema>

export const ExtensionModelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  capabilities: z.array(z.enum(['text', 'reasoning', 'tools', 'vision', 'documents'])).default(['text'])
})
export type ExtensionModelDescriptor = z.infer<typeof ExtensionModelDescriptorSchema>

export const ExtensionCredentialProtectionSchema = z.object({
  mode: z.enum(['primary', 'encrypted-fallback', 'unavailable']),
  degraded: z.boolean(),
  available: z.boolean()
})
export type ExtensionCredentialProtection = z.infer<typeof ExtensionCredentialProtectionSchema>

export const ExtensionProviderStoreDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  providers: z.record(z.string(), ExtensionProviderDefinitionSchema)
})

export const ExtensionAccountStoreDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  accounts: z.record(z.string(), ExtensionAccountRecordSchema)
})

export const ExtensionProviderBindingStoreDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  bindings: z.record(z.string(), ExtensionProviderBindingRecordSchema)
})
