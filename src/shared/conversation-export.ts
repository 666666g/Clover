export const CONVERSATION_EXPORT_FORMATS = ['md', 'pdf'] as const
export const CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS = 2_000_000

export type ConversationExportFormat = (typeof CONVERSATION_EXPORT_FORMATS)[number]

export type ConversationExportPayload = {
  title: string
  format: ConversationExportFormat
  markdown: string
  defaultFileName: string
}

export type ConversationExportResult =
  | {
      ok: true
      path: string
      format: ConversationExportFormat
      exportedAt: string
    }
  | {
      ok: false
      canceled: true
      message?: string
    }
  | {
      ok: false
      canceled: false
      message: string
    }
