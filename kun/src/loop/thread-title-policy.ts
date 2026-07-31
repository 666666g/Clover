const PLACEHOLDER_THREAD_TITLES = new Set(['New Thread', '新会话', 'Untitled', '未命名'])
const CODEX_PLACEHOLDER_TITLE = /^__codex_[a-z0-9_]+__$/i

function isAutoTitleableThreadTitle(title: string | null | undefined): boolean {
  const raw = title?.trim() ?? ''
  if (!raw) return true
  if (PLACEHOLDER_THREAD_TITLES.has(raw)) return true
  if (CODEX_PLACEHOLDER_TITLE.test(raw)) return true
  return false
}

/**
 * Whether the backend LLM titler may (re)generate a thread's title.
 *
 * - `titleAuto === false` → user renamed it manually; never overwrite.
 * - `titleAuto === true`  → client set a provisional first-message title; upgrade it.
 * - absent (legacy)       → only upgrade placeholder titles, never a real one.
 */
export function canUpgradeThreadTitle(thread: {
  title?: string | null
  titleAuto?: boolean
}): boolean {
  if (thread.titleAuto === false) return false
  if (thread.titleAuto === true) return true
  return isAutoTitleableThreadTitle(thread.title)
}
