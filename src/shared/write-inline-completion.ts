export type WriteInlineCompletionMode = 'short' | 'long'

export type WriteInlineCompletionRequest = {
  prefix: string
  suffix: string
  mode?: WriteInlineCompletionMode
  workspaceRoot?: string
  currentFilePath?: string
  cursor: {
    line: number
    column: number
  }
  context: {
    language: string
    currentLinePrefix: string
    currentLineSuffix: string
    previousLine: string
    previousNonEmptyLine: string
    nextLine: string
    indentation: string
    signals: {
      list: boolean
      quote: boolean
      heading: boolean
      table: boolean
      atLineEnd: boolean
      endsWithSentencePunctuation: boolean
      previousLineEndsWithSentencePunctuation: boolean
      prefersNewLineCompletion: boolean
      paragraphBreakOpportunity: boolean
    }
  }
  policy: {
    name: string
    instruction: string
    acceptanceCriteria: string[]
    rejectionCriteria: string[]
  }
  preview: {
    local: string
    documentTail: string
  }
  model?: string
}

export type WriteInlineCompletionResult =
  | {
      ok: true
      completion: string
      model: string
      mode?: WriteInlineCompletionMode
    }
  | { ok: false; message: string }

export type WriteInlineCompletionDebugEntry = {
  id: string
  createdAt: string
  durationMs: number
  ok: boolean
  model: string
  mode: WriteInlineCompletionMode
  currentFilePath?: string
  prompt: string
  suffix: string
  rawResponse: string
  completion: string
  errorMessage?: string
  referenceCount: number
  promptChars: number
  suffixChars: number
  responseChars: number
}
