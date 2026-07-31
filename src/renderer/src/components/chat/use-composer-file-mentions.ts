import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import {
  composerFileReferenceKey,
  filterWorkspaceFileMentionSuggestions,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isComposerDirectoryReference,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileMention,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import {
  loadWorkspaceFileIndex,
  loadWorkspaceMentionPathSuggestions,
  mergeMentionCandidates
} from '../../lib/workspace-file-index'

export function shouldCaptureFileMentionCommitKey(
  event: Pick<ReactKeyboardEvent<HTMLTextAreaElement>, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>
): boolean {
  if (event.key === 'Tab') return true
  return event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey
}

type Options = {
  enabled: boolean
  canCompose: boolean
  input: string
  setInput: (value: string) => void
  workspaceRoot: string
  slashQuery: string | null
  menuBlocked: boolean
  references: ComposerFileReference[]
  extraCandidates: ComposerFileReference[]
  textareaRef: RefObject<HTMLTextAreaElement | null>
  focusComposer: () => void
  onAdd?: (reference: ComposerFileReference) => void
  onRemove?: (relativePath: string) => void
}

/** Owns file-mention discovery, selection, token/reference synchronization, and keyboard capture. */
export function useComposerFileMentions({
  enabled,
  canCompose,
  input,
  setInput,
  workspaceRoot,
  slashQuery,
  menuBlocked,
  references,
  extraCandidates,
  textareaRef,
  focusComposer,
  onAdd,
  onRemove
}: Options) {
  const [cursor, setCursor] = useState(() => input.length)
  const [suggestions, setSuggestions] = useState<ComposerFileReference[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const presenceRef = useRef<Map<string, boolean>>(new Map())
  const activeMention = useMemo<ComposerFileMention | null>(() => {
    if (!enabled || slashQuery != null || !workspaceRoot) return null
    return getFileMentionAtCursor(input, cursor)
  }, [cursor, enabled, input, slashQuery, workspaceRoot])
  const activeKey = activeMention
    ? `${activeMention.start}:${activeMention.query}:${activeMention.quoted ? 'q' : 'p'}`
    : null
  const showMenu = canCompose && Boolean(activeMention) && activeKey !== dismissedKey && !menuBlocked
  const highlighted = suggestions.length > 0
    ? suggestions[Math.min(selectedIndex, suggestions.length - 1)]
    : null

  useEffect(() => setSelectedIndex(0), [activeKey])

  useEffect(() => {
    if (!showMenu || !activeMention || !workspaceRoot) {
      setSuggestions((current) => (current.length === 0 ? current : []))
      setLoading(false)
      return
    }
    let cancelled = false
    const query = activeMention.query
    const timer = window.setTimeout(() => {
      setLoading(true)
      void Promise.all([
        loadWorkspaceFileIndex(workspaceRoot),
        loadWorkspaceMentionPathSuggestions(workspaceRoot, query).catch(() => [])
      ])
        .then(([index, pathSuggestions]) => {
          if (cancelled) return
          const indexedCandidates = mergeMentionCandidates(
            extraCandidates,
            [...index.directories, ...index.files]
          )
          setSuggestions(filterWorkspaceFileMentionSuggestions(
            mergeMentionCandidates(indexedCandidates, pathSuggestions),
            query,
            references
          ))
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeMention, extraCandidates, references, showMenu, workspaceRoot])

  useEffect(() => {
    const previous = presenceRef.current
    const next = new Map<string, boolean>()
    const removedRelativePaths: string[] = []
    for (const reference of references) {
      const key = composerFileReferenceKey(reference)
      const present = hasComposerFileMentionToken(
        input,
        reference.relativePath,
        isComposerDirectoryReference(reference)
      )
      if (previous.get(key) === true && !present) removedRelativePaths.push(reference.relativePath)
      next.set(key, present)
    }
    presenceRef.current = next
    if (!onRemove) return
    for (const relativePath of removedRelativePaths) onRemove(relativePath)
  }, [input, onRemove, references])

  const syncCursor = (element = textareaRef.current): void => {
    if (element) setCursor(element.selectionStart ?? input.length)
  }

  const updateInput = (value: string, nextCursor: number): void => {
    setInput(value)
    setCursor(nextCursor)
    setDismissedKey(null)
  }

  const applyReference = (reference: ComposerFileReference | null): void => {
    if (!reference || !activeMention) return
    const next = replaceFileMentionInInput(input, activeMention, reference)
    setInput(next.input)
    onAdd?.(reference)
    setDismissedKey(null)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
      setCursor(next.cursor)
    })
  }

  const removeReference = (reference: ComposerFileReference): void => {
    onRemove?.(reference.relativePath)
    presenceRef.current.set(composerFileReferenceKey(reference), false)
    const nextInput = removeComposerFileMentionToken(
      input,
      reference.relativePath,
      isComposerDirectoryReference(reference)
    )
    if (nextInput !== input) {
      setInput(nextInput)
      window.requestAnimationFrame(() => syncCursor())
    }
    focusComposer()
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    composing: boolean
  ): boolean => {
    if (composing || !showMenu) return false
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % suggestions.length)
      return true
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => current === 0 ? suggestions.length - 1 : current - 1)
      return true
    }
    if (shouldCaptureFileMentionCommitKey(event)) {
      event.preventDefault()
      if (highlighted) applyReference(highlighted)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedKey(activeKey)
      setSuggestions([])
      return true
    }
    return false
  }

  return {
    showMenu,
    suggestions,
    loading,
    selectedIndex,
    highlighted,
    setCursor,
    syncCursor,
    updateInput,
    applyReference,
    removeReference,
    handleKeyDown
  }
}
