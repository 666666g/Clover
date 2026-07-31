export type DesignMdHighlightToken = { text: string; kind: 'plain' | 'fence' | 'heading' | 'key' | 'value' | 'comment' }

export function highlightDesignMdLine(line: string): DesignMdHighlightToken[] {
  if (/^---\s*$/.test(line)) return [{ text: line, kind: 'fence' }]
  if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: 'heading' }]
  if (/^\s*#/.test(line)) return [{ text: line, kind: 'comment' }]
  const match = /^(\s*[^:#][^:]*:)(.*)$/.exec(line)
  if (match) return [{ text: match[1], kind: 'key' }, { text: match[2], kind: 'value' }]
  return [{ text: line, kind: 'plain' }]
}

export const DESIGN_MD_HIGHLIGHT_CLASS: Record<DesignMdHighlightToken['kind'], string> = {
  plain: 'text-slate-700 dark:text-slate-200',
  fence: 'text-blue-600 dark:text-blue-300',
  heading: 'font-semibold text-purple-700 dark:text-purple-300',
  key: 'text-cyan-700 dark:text-cyan-300',
  value: 'text-amber-700 dark:text-amber-300',
  comment: 'text-slate-400'
}
