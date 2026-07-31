import { z } from 'zod'
import { MAX_ID_LENGTH, MAX_PATH_LENGTH } from './common'

export const MAX_RUNTIME_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024
export const MAX_RUNTIME_IMAGE_SOURCE_BASE64_CHARS = Math.ceil(MAX_RUNTIME_IMAGE_SOURCE_BYTES / 3) * 4 + 4

function isAbsoluteImagePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('clipboard') }),
  z.strictObject({
    kind: z.literal('localPath'),
    path: z.string().trim().min(1).max(MAX_PATH_LENGTH).refine(isAbsoluteImagePath, 'image path must be absolute')
  }),
  z.strictObject({
    kind: z.literal('base64'),
    dataBase64: z.string().min(4).max(MAX_RUNTIME_IMAGE_SOURCE_BASE64_CHARS),
    mimeType: z.string().trim().min(3).max(128).regex(/^image\/[A-Za-z0-9.+-]+$/)
  })
])

export const runtimeImageAttachmentUploadPayloadSchema = z.strictObject({
  source: sourceSchema,
  name: z.string().trim().min(1).max(512).optional(),
  threadId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
  workspace: z.string().trim().min(1).max(MAX_PATH_LENGTH).optional()
})
