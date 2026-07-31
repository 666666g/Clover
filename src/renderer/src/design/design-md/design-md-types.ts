export type DesignMdDiagnosticSeverity = 'error' | 'warning' | 'info'

export type DesignMdDiagnostic = {
  severity: DesignMdDiagnosticSeverity
  message: string
  path?: string
  source: 'google' | 'kun'
}

export type DesignMdColor = {
  raw: string
  hex?: string
  luminance?: number
}

export type DesignMdDimension = {
  raw: string
  value?: number
  unit?: string
}

export type DesignMdTypography = {
  raw: Record<string, unknown>
  fontFamily?: string
  fontSize?: DesignMdDimension
  fontWeight?: number
  lineHeight?: DesignMdDimension
  letterSpacing?: DesignMdDimension
}

export type DesignMdMarkdownSection = {
  heading: string
  level: number
  content: string
}

export type ProjectDesignMdDocument = {
  name: string
  description?: string
  colors: Record<string, DesignMdColor>
  typography: Record<string, DesignMdTypography>
  rounded: Record<string, DesignMdDimension>
  spacing: Record<string, DesignMdDimension>
  components: Record<string, Record<string, unknown>>
  extensions: Record<string, unknown>
  sections: DesignMdMarkdownSection[]
  raw: string
  sourceHash: string
}

export type ProjectDesignMdParseResult = {
  ok: boolean
  document: ProjectDesignMdDocument | null
  diagnostics: DesignMdDiagnostic[]
}

export type ProjectDesignMdDraft = {
  content: string
  baseHash: string
  dirty: boolean
}

export type ProjectDesignMdConflict = {
  baseHash: string
  currentHash: string
  draftContent: string
  currentContent: string
}

export type ProjectDesignMdSyncStatus =
  | 'loading'
  | 'missing'
  | 'ready'
  | 'dirty'
  | 'invalid'
  | 'conflict'
  | 'saving'
