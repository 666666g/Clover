function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? 'presentation.md'
}

function deckNameFromPath(value: string): string {
  const name = basename(value).replace(/\.(?:md|markdown)$/i, '')
  const safe = name.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '')
  return safe || 'presentation'
}

/** PPT Master v1 intentionally accepts only plain Markdown, not MDX. */
export function isPresentationMarkdownPath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown)$/i.test(path.trim()))
}

/**
 * Explicitly activates the managed wrapper and preserves the source-file
 * contract even if the broader Write context later changes.
 */
export function buildWritePresentationPrompt(input: {
  workspaceRoot: string
  sourcePath: string
}): string {
  const deckName = deckNameFromPath(input.sourcePath)
  return [
    '$ppt-master',
    '请使用 PPT Master 把当前 Markdown 制作为原生可编辑的 PPTX。',
    '',
    `唯一来源 Markdown：${input.sourcePath}`,
    `工作区：${input.workspaceRoot}`,
    `PPT 项目目录：.kun-presentations/${deckName}`,
    `最终文件：presentations/${deckName}.pptx`,
    '',
    '先读取 Markdown 并给出幻灯片大纲、建议页数、受众和视觉方向；再调用 ppt_master_confirm_design 展示原生确认卡。只有我在确认卡中选择“Generate PPT”后，才能继续生成，并把返回的 approval_token 传给每次 ppt_master_run 调用。',
    '不要修改、重命名或移动来源 Markdown；导入项目时必须复制来源。确认后使用 ppt_master_run 依次初始化、导入、检查、整理并导出。'
  ].join('\n')
}
