import { app, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  ConversationExportFormat,
  ConversationExportPayload,
  ConversationExportResult
} from '../../shared/conversation-export'
import { renderMarkdownDocumentToPdf } from './write-export-service'

const FALLBACK_FILE_NAME = 'Kun-conversation'

export function sanitizeConversationExportFileName(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || '<>:"/\\|?*'.includes(character) ? '-' : character
  })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.(?:md|pdf)$/i, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
}

export function ensureConversationExportExtension(
  filePath: string,
  format: ConversationExportFormat
): string {
  const expected = `.${format}`
  const current = extname(filePath)
  if (current.toLowerCase() === expected) return filePath
  return current ? `${filePath.slice(0, -current.length)}${expected}` : `${filePath}${expected}`
}

function exportDialogOptions(
  payload: ConversationExportPayload,
  downloadsPath: string
): Electron.SaveDialogOptions {
  const baseName =
    sanitizeConversationExportFileName(payload.defaultFileName) ||
    sanitizeConversationExportFileName(payload.title) ||
    FALLBACK_FILE_NAME
  const extension = payload.format
  return {
    title: 'Export conversation',
    defaultPath: join(downloadsPath, `${baseName}.${extension}`),
    filters: [{
      name: payload.format === 'pdf' ? 'PDF' : 'Markdown',
      extensions: [extension]
    }]
  }
}

export async function exportConversation(
  payload: ConversationExportPayload,
  options?: { parentWindow?: BrowserWindow | null; downloadsPath?: string }
): Promise<ConversationExportResult> {
  try {
    const downloadsPath = options?.downloadsPath ?? app.getPath('downloads')
    const dialogOptions = exportDialogOptions(payload, downloadsPath)
    const dialogResult = options?.parentWindow
      ? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { ok: false, canceled: true }
    }

    const targetPath = ensureConversationExportExtension(dialogResult.filePath, payload.format)
    if (payload.format === 'md') {
      await writeFile(targetPath, payload.markdown, 'utf8')
    } else {
      const sourceFileName =
        sanitizeConversationExportFileName(payload.defaultFileName) || FALLBACK_FILE_NAME
      const pdf = await renderMarkdownDocumentToPdf({
        sourcePath: join(downloadsPath, `${sourceFileName}.md`),
        content: payload.markdown,
        title: payload.title
      })
      await writeFile(targetPath, pdf)
    }

    return {
      ok: true,
      path: targetPath,
      format: payload.format,
      exportedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
