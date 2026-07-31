import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ClawGeneratedFileV1 } from '../shared/app-settings'

export const MAX_IM_FILE_UPLOAD_BYTES = 50 * 1024 * 1024

export type ImAttachmentLogFn = (category: string, message: string, detail?: unknown) => void

/** Authorizes generated files against one conversation workspace before upload. */
export async function authorizeImGeneratedFiles(input: {
  files: readonly ClawGeneratedFileV1[]
  workspaceRoot: string
  context?: Record<string, unknown>
  logError: ImAttachmentLogFn
}): Promise<ClawGeneratedFileV1[]> {
  const root = input.workspaceRoot.trim()
  if (!root || input.files.length === 0) return []
  let realRoot = ''
  try {
    realRoot = await realpath(resolve(root))
  } catch (error) {
    input.logError('claw-im', 'Failed to resolve IM file workspace root', {
      ...input.context,
      workspaceRoot: root,
      message: errorMessage(error)
    })
    return []
  }

  const resolvedFiles: ClawGeneratedFileV1[] = []
  const seen = new Set<string>()
  for (const file of input.files) {
    try {
      const realFile = await realpath(resolve(file.path))
      const relativePath = relative(realRoot, realFile)
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        input.logError('claw-im', 'Skipping generated file outside the IM workspace', {
          ...input.context,
          filePath: file.path,
          workspaceRoot: root
        })
        continue
      }
      if (seen.has(realFile)) continue
      const fileStat = await stat(realFile)
      if (!fileStat.isFile()) continue
      if (fileStat.size > MAX_IM_FILE_UPLOAD_BYTES) {
        input.logError('claw-im', 'Skipping generated file because it is too large for IM upload', {
          ...input.context,
          filePath: realFile,
          bytes: fileStat.size,
          maxBytes: MAX_IM_FILE_UPLOAD_BYTES
        })
        continue
      }
      seen.add(realFile)
      resolvedFiles.push({
        ...file,
        path: realFile,
        fileName: file.fileName || realFile.split(/[\\/]/).pop() || 'attachment'
      })
    } catch (error) {
      input.logError('claw-im', 'Skipping generated file that cannot be read for IM upload', {
        ...input.context,
        filePath: file.path,
        message: errorMessage(error)
      })
    }
  }
  return resolvedFiles
}

export type ImAttachmentDeliveryResult = {
  sent: ClawGeneratedFileV1[]
  failed: Array<{ file: ClawGeneratedFileV1; message: string }>
}

/** Runs one platform upload adapter per authorized file and records partial failure. */
export async function deliverImGeneratedFiles(input: {
  files: readonly ClawGeneratedFileV1[]
  upload: (file: ClawGeneratedFileV1) => Promise<void>
  onFailure?: (file: ClawGeneratedFileV1, message: string) => void
}): Promise<ImAttachmentDeliveryResult> {
  const sent: ClawGeneratedFileV1[] = []
  const failed: ImAttachmentDeliveryResult['failed'] = []
  for (const file of input.files) {
    try {
      await input.upload(file)
      sent.push(file)
    } catch (error) {
      const message = errorMessage(error)
      failed.push({ file, message })
      input.onFailure?.(file, message)
    }
  }
  return { sent, failed }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
