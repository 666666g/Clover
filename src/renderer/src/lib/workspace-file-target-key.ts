import type { WorkspaceFileTarget } from '@shared/workspace-file'

function rendererPlatform(): string {
  return typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
}

function isWindowsStylePath(path: string): boolean {
  return /^[a-z]:[/\\]/i.test(path) || /^[/\\]{2}[^/\\]/.test(path)
}

function normalizeKeyPath(path: string): string {
  const value = path.trim().replaceAll('\\', '/')
  if (!value) return ''
  if (/^[a-z]:\/+$/i.test(value)) return `${value.slice(0, 2)}/`
  const prefix = value.startsWith('//') ? '//' : value.startsWith('/') ? '/' : ''
  const rest = value
    .slice(prefix.length)
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  return prefix + rest
}

export function workspaceFileTargetKey(
  target: WorkspaceFileTarget | null | undefined,
  platform = rendererPlatform()
): string {
  if (!target?.path) return ''
  const normalizedRoot = normalizeKeyPath(target.workspaceRoot ?? '')
  const normalizedPath = normalizeKeyPath(target.path)
  if (!normalizedPath) return ''
  const key = `${normalizedRoot}\n${normalizedPath}`
  const caseInsensitive = platform === 'win32' ||
    isWindowsStylePath(normalizedPath) ||
    isWindowsStylePath(normalizedRoot)
  return caseInsensitive ? key.toLowerCase() : key
}
