import { z } from 'zod'
import { SemverRangeSchema, SemverSchema } from './common.js'

export const CompatibilityDimensionSchema = z.enum([
  'package',
  'manifest',
  'api',
  'engine',
  'rpc',
  'state'
])
export type CompatibilityDimension = z.infer<typeof CompatibilityDimensionSchema>

export const CompatibilityDiagnosticSchema = z.strictObject({
  compatible: z.boolean(),
  dimension: CompatibilityDimensionSchema,
  declared: z.string(),
  supported: z.string(),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(4096)
})
export type CompatibilityDiagnostic = z.infer<typeof CompatibilityDiagnosticSchema>

export const ApiNegotiationRequestSchema = z.strictObject({
  declaredApiVersion: SemverSchema,
  supportedApiVersions: z.array(SemverSchema).min(1),
  requiredCapabilities: z.array(z.string().min(1).max(128)).default([]),
  capabilitiesByVersion: z.record(SemverSchema, z.array(z.string().min(1).max(128))).default({})
})
export type ApiNegotiationRequest = z.input<typeof ApiNegotiationRequestSchema>

export const ApiNegotiationResultSchema = z.discriminatedUnion('compatible', [
  z.strictObject({
    compatible: z.literal(true),
    declaredApiVersion: SemverSchema,
    negotiatedApiVersion: SemverSchema,
    supportedMajors: z.array(z.number().int().positive()),
    capabilities: z.array(z.string()),
    adapter: z.enum(['current', 'previous'])
  }),
  z.strictObject({
    compatible: z.literal(false),
    declaredApiVersion: SemverSchema,
    supportedMajors: z.array(z.number().int().positive()),
    code: z.enum(['API_MAJOR_UNSUPPORTED', 'API_MINOR_UNSUPPORTED', 'CAPABILITY_REQUIRED']),
    message: z.string().min(1).max(4096),
    missingCapabilities: z.array(z.string()).optional()
  })
])
export type ApiNegotiationResult = z.infer<typeof ApiNegotiationResultSchema>

type ParsedSemver = { major: number; minor: number; patch: number }

function parseSemver(value: string): ParsedSemver {
  const parsed = SemverSchema.parse(value)
  const [major, minor, patch] = parsed.split(/[+-]/, 1)[0].split('.').map(Number)
  return { major, minor, patch }
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

export function supportedApiMajors(supportedVersions: readonly string[]): number[] {
  const majors = [...new Set(supportedVersions.map((version) => parseSemver(version).major))].sort(
    (a, b) => b - a
  )
  if (majors.length === 0) throw new Error('At least one supported API version is required')
  const current = majors[0]
  const allowed = current === 1 ? [1] : [current, current - 1]
  return majors.filter((major) => allowed.includes(major))
}

export function negotiateApiVersion(input: ApiNegotiationRequest): ApiNegotiationResult {
  const request = ApiNegotiationRequestSchema.parse(input)
  const declared = parseSemver(request.declaredApiVersion)
  const supportedMajors = supportedApiMajors(request.supportedApiVersions)
  const candidates = request.supportedApiVersions
    .filter((version) => parseSemver(version).major === declared.major)
    .sort((a, b) => compareSemver(b, a))

  if (!supportedMajors.includes(declared.major) || candidates.length === 0) {
    return {
      compatible: false,
      declaredApiVersion: request.declaredApiVersion,
      supportedMajors,
      code: 'API_MAJOR_UNSUPPORTED',
      message: `Extension API major ${declared.major} is not supported; supported majors: ${supportedMajors.join(', ')}`
    }
  }

  const selected = candidates[0]
  const host = parseSemver(selected)
  if (declared.minor > host.minor) {
    return {
      compatible: false,
      declaredApiVersion: request.declaredApiVersion,
      supportedMajors,
      code: 'API_MINOR_UNSUPPORTED',
      message: `Extension requires API ${request.declaredApiVersion}, but host supports ${selected}`
    }
  }

  const capabilities = request.capabilitiesByVersion[selected] ?? []
  const missing = request.requiredCapabilities.filter((capability) => !capabilities.includes(capability))
  if (missing.length > 0) {
    return {
      compatible: false,
      declaredApiVersion: request.declaredApiVersion,
      supportedMajors,
      code: 'CAPABILITY_REQUIRED',
      message: `Required Extension API capabilities are unavailable: ${missing.join(', ')}`,
      missingCapabilities: missing
    }
  }

  return {
    compatible: true,
    declaredApiVersion: request.declaredApiVersion,
    negotiatedApiVersion: selected,
    supportedMajors,
    capabilities,
    adapter: declared.major === supportedMajors[0] ? 'current' : 'previous'
  }
}

export const CompatibilityReportSchema = z.strictObject({
  extensionVersion: SemverSchema,
  manifestVersion: z.number().int().positive(),
  api: ApiNegotiationResultSchema,
  kunEngine: z.strictObject({ declared: SemverRangeSchema, running: SemverSchema, compatible: z.boolean() }),
  rpc: z.strictObject({ declared: z.number().int().positive(), negotiated: z.number().int().positive().optional(), compatible: z.boolean() }),
  stateSchemaVersion: z.number().int().nonnegative(),
  diagnostics: z.array(CompatibilityDiagnosticSchema)
})
export type CompatibilityReport = z.infer<typeof CompatibilityReportSchema>
