import { z } from 'zod'
import { JsonObjectSchema, type JsonObject } from './common.js'

export const EXTENSION_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED_CAPABILITY',
  'INCOMPATIBLE_API',
  'INCOMPATIBLE_MANIFEST',
  'INCOMPATIBLE_ENGINE',
  'INCOMPATIBLE_RPC',
  'ACTIVATION_FAILED',
  'ACTIVATION_TIMEOUT',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'INTERACTION_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'ACCOUNT_REQUIRED',
  'PROTOCOL_ERROR',
  'RESOURCE_LIMIT',
  'HOST_UNAVAILABLE',
  'INTERNAL_ERROR'
] as const

export const ExtensionErrorCodeSchema = z.enum(EXTENSION_ERROR_CODES)
export type ExtensionErrorCode = z.infer<typeof ExtensionErrorCodeSchema>

export const ExtensionErrorSchema = z.strictObject({
  code: ExtensionErrorCodeSchema,
  message: z.string().min(1).max(4096),
  operation: z.string().min(1).max(128).optional(),
  extensionId: z.string().min(1).max(129).optional(),
  retryable: z.boolean().default(false),
  details: JsonObjectSchema.optional(),
  documentation: z.string().url().optional()
})
export type ExtensionErrorData = z.infer<typeof ExtensionErrorSchema>

export class ExtensionApiError extends Error implements ExtensionErrorData {
  readonly code: ExtensionErrorCode
  readonly operation?: string
  readonly extensionId?: string
  readonly retryable: boolean
  readonly details?: JsonObject
  readonly documentation?: string

  constructor(data: ExtensionErrorData) {
    super(data.message)
    this.name = 'ExtensionApiError'
    this.code = data.code
    this.operation = data.operation
    this.extensionId = data.extensionId
    this.retryable = data.retryable
    this.details = data.details
    this.documentation = data.documentation
  }

  static from(value: unknown, fallbackOperation?: string): ExtensionApiError {
    if (value instanceof ExtensionApiError) return value
    const parsed = ExtensionErrorSchema.safeParse(value)
    if (parsed.success) return new ExtensionApiError(parsed.data)
    return new ExtensionApiError({
      code: 'INTERNAL_ERROR',
      message: value instanceof Error ? value.message : 'Unknown extension host error',
      operation: fallbackOperation,
      retryable: false
    })
  }

  toJSON(): ExtensionErrorData {
    return ExtensionErrorSchema.parse({
      code: this.code,
      message: this.message,
      operation: this.operation,
      extensionId: this.extensionId,
      retryable: this.retryable,
      details: this.details,
      documentation: this.documentation
    })
  }
}

export const DiagnosticSchema = z.strictObject({
  code: z.string().min(1).max(128),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(4096),
  path: z.string().max(1024).optional(),
  remediation: z.string().max(4096).optional(),
  documentation: z.string().url().optional()
})
export type Diagnostic = z.infer<typeof DiagnosticSchema>
