import type {
  RuntimeImageAttachmentSource,
  RuntimeImageAttachmentUploadRequest,
  RuntimeImageAttachmentUploadResult
} from '@shared/runtime-image-attachment'
import { arrayBufferToBase64 } from './image-attachment-upload'

export type RuntimeImageAttachmentUploadSuccess = Extract<
  RuntimeImageAttachmentUploadResult,
  { ok: true }
>

export async function runtimeImageSourceForFile(
  file: File,
  localFilePath?: string
): Promise<RuntimeImageAttachmentSource> {
  if (localFilePath?.trim()) return { kind: 'localPath', path: localFilePath.trim() }
  return {
    kind: 'base64',
    dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
    mimeType: file.type || 'image/png'
  }
}

export async function uploadRuntimeImageAttachment(
  request: RuntimeImageAttachmentUploadRequest
): Promise<RuntimeImageAttachmentUploadSuccess> {
  if (typeof window.kunGui?.uploadRuntimeImageAttachment !== 'function') {
    throw new Error('Image attachment upload is unavailable.')
  }
  const result = await window.kunGui.uploadRuntimeImageAttachment(request)
  if (!result.ok) throw new Error(result.message)
  return result
}

export function runtimeImagePreviewUrl(result: RuntimeImageAttachmentUploadSuccess): string {
  return `data:${result.preview.mimeType};base64,${result.preview.dataBase64}`
}
