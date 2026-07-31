import { z } from 'zod'
import { JsonObjectSchema } from './common.js'

export const AuthenticationTypeSchema = z.enum(['api-key', 'oauth2-pkce', 'device-code', 'custom'])
export type AuthenticationType = z.infer<typeof AuthenticationTypeSchema>

export const AccountStatusSchema = z.enum([
  'connected',
  'expired',
  'interaction-required',
  'error',
  'unavailable'
])
export type AccountStatus = z.infer<typeof AccountStatusSchema>

export const CredentialReferenceSchema = z.string().min(1).max(512).brand<'CredentialReference'>()
export type CredentialReference = z.infer<typeof CredentialReferenceSchema>

export const AccountSchema = z.strictObject({
  id: z.string().min(1).max(256),
  providerId: z.string().min(1).max(129),
  label: z.string().min(1).max(128),
  authenticationType: AuthenticationTypeSchema,
  status: AccountStatusSchema,
  metadata: JsonObjectSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  protection: z.enum(['system', 'encrypted-fallback', 'unavailable']).optional()
})
export type Account = z.infer<typeof AccountSchema>

export const ProviderBindingSchema = z.strictObject({
  providerId: z.string().min(1).max(129),
  accountId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256)
})
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>

export const AuthenticationProviderDeclarationSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1).max(128),
  type: AuthenticationTypeSchema,
  clientId: z.string().min(1).max(512).optional(),
  redirectUri: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  deviceAuthorizationUrl: z.string().url().optional(),
  scopes: z.array(z.string().min(1).max(256)).max(128).optional(),
  apiKey: z
    .strictObject({
      header: z.string().min(1).max(128).default('Authorization'),
      prefix: z.string().max(64).default('Bearer ')
    })
    .optional()
}).superRefine((value, context) => {
  if (value.type === 'oauth2-pkce') {
    for (const field of ['clientId', 'redirectUri', 'authorizationUrl', 'tokenUrl'] as const) {
      if (!value[field]) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} is required for oauth2-pkce` })
      }
    }
  }
  if (value.type === 'device-code') {
    for (const field of ['clientId', 'deviceAuthorizationUrl', 'tokenUrl'] as const) {
      if (!value[field]) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} is required for device-code` })
      }
    }
  }
})
export type AuthenticationProviderDeclaration = z.infer<
  typeof AuthenticationProviderDeclarationSchema
>

export const ListAccountsRequestSchema = z.strictObject({
  providerId: z.string().min(1).max(129).optional(),
  includeUnavailable: z.boolean().default(false)
})
export type ListAccountsRequest = z.input<typeof ListAccountsRequestSchema>

export const CreateAccountSessionRequestSchema = z.strictObject({
  providerId: z.string().min(1).max(129),
  authenticationProviderId: z.string().min(1).max(129),
  label: z.string().min(1).max(128).optional(),
  scopes: z.array(z.string().min(1).max(256)).max(128).optional()
})
export type CreateAccountSessionRequest = z.infer<typeof CreateAccountSessionRequestSchema>

export const AccountSessionSchema = z.strictObject({
  id: z.string().min(1).max(256),
  status: z.enum(['pending', 'completed', 'cancelled', 'expired', 'failed']),
  account: AccountSchema.optional(),
  verificationUrl: z.string().url().optional(),
  userCode: z.string().min(1).max(128).optional(),
  expiresAt: z.string().datetime().optional(),
  message: z.string().max(4096).optional()
})
export type AccountSession = z.infer<typeof AccountSessionSchema>

export const AuthenticatedFetchRequestSchema = z.strictObject({
  accountId: z.string().min(1).max(256),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string().max(8192)).default({}),
  body: z.string().max(8 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(1).max(300_000).optional()
})
export type AuthenticatedFetchRequest = z.input<typeof AuthenticatedFetchRequestSchema>

export const RevealSecretRequestSchema = z.strictObject({
  accountId: z.string().min(1).max(256),
  operation: z.string().min(1).max(256)
})
export type RevealSecretRequest = z.infer<typeof RevealSecretRequestSchema>
