export type ProjectDesignMdOfficialFinding = {
  severity: 'error' | 'warning' | 'info'
  path?: string
  message: string
}

export type ProjectDesignMdOfficialColor = {
  hex: string
  luminance: number
}

export type ProjectDesignMdOfficialDimension = {
  value: number
  unit: string
}

export type ProjectDesignMdOfficialTypography = {
  fontFamily?: string
  fontSize?: ProjectDesignMdOfficialDimension
  fontWeight?: number
  lineHeight?: ProjectDesignMdOfficialDimension
  letterSpacing?: ProjectDesignMdOfficialDimension
}

export type ProjectDesignMdOfficialLintResult =
  | {
      ok: true
      findings: ProjectDesignMdOfficialFinding[]
      colors: Record<string, ProjectDesignMdOfficialColor>
      typography: Record<string, ProjectDesignMdOfficialTypography>
      rounded: Record<string, ProjectDesignMdOfficialDimension>
      spacing: Record<string, ProjectDesignMdOfficialDimension>
      sections: string[]
    }
  | { ok: false; message: string }
