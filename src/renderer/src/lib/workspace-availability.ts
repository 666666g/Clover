import i18n from '../i18n'

export async function workspaceDirectoryExists(workspaceRoot: string): Promise<boolean> {
  const normalized = workspaceRoot.trim()
  if (!normalized) return false
  if (typeof window === 'undefined') return true
  if (typeof window.kunGui?.workspaceDirectoryExists !== 'function') {
    return typeof window.kunGui?.platform !== 'string'
  }
  try {
    return await window.kunGui.workspaceDirectoryExists(normalized)
  } catch {
    return false
  }
}

export function workspaceMissingError(): string {
  return i18n.t('common:workspaceDirectoryMissingError')
}

export async function showWorkspaceMissingDialog(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined' || typeof window.kunGui?.alertDialog !== 'function') return
  try {
    await window.kunGui.alertDialog({
      message: i18n.t('common:workspaceDirectoryMissingTitle'),
      detail: i18n.t('common:workspaceDirectoryMissingDetail', { path: workspaceRoot }),
      buttonLabel: i18n.t('common:confirm')
    })
  } catch {
    // 主进程弹窗失败时仍由页面错误状态阻止创建会话。
  }
}
