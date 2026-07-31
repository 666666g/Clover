import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Columns2,
  Eye,
  FileCode2,
  Type
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteExportFormat } from '@shared/write-export'
import { WRITE_INFOGRAPHIC_MAX_TEXT_CHARS } from '@shared/write-infographic'
import { useChatStore } from '../../store/chat-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import {
  useWriteWorkspaceStore,
  type WritePreviewMode,
  type WriteSaveStatus,
  writeBasenameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { pathsEqual } from '../../write/write-workspace-store-helpers'
import { getWriteRenderSafety } from '../../write/write-render-safety'
import {
  applyWriteInlineEditReplacement,
  buildWriteInlineEditCompletionRequest,
  buildWriteInlineEditDraft
} from '../../write/inline-edit'
import type { WriteBlockType } from '../../write/block-type'
import { toggleWriteInlineFormat, type WriteInlineFormatKind } from '../../write/inline-format'
import { resolveWriteQuickActions, type ResolvedWriteQuickAction } from '../../write/quick-actions'
import { createWriteRecentEdit } from '../../write/recent-edits'
import {
  beginPendingInfographic,
  buildPendingInfographicMarkdown,
  finishPendingInfographic,
  lineEndAfter,
  replacePendingInfographicInText
} from '../../write/infographic-pending'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import { useWriteSplitScrollSync } from './use-write-split-scroll-sync'
import { useWriteWorkspaceLifecycle } from './use-write-workspace-lifecycle'
import { WriteWorkspaceEmptyState } from './WriteWorkspaceEmptyState'
import { WriteWorkspaceToolbar } from './WriteWorkspaceToolbar'
import { WriteInlineAgent } from './WriteInlineAgent'
import { WriteWorkspaceDocumentPane } from './WriteWorkspaceDocumentPane'
import { resolveWriteAgentPreset } from '../../write/agent-presets'
import type { WriteEditorSelectionState, WriteMarkdownEditorHandle } from './WriteMarkdownEditor'
import {
  INLINE_EDIT_RECENT_CONTEXT_CHARS,
  WRITE_EXPORT_NOTICE_MS,
  writePreviewDebounceMs,
  WRITE_RICH_CLIPBOARD_ACTION,
  exportFormatLabel,
  formatSaveLabel,
  isInlineCompletionToggleShortcut,
  inlineAgentPosition,
  isMarkdownFile,
  computeWriteDocumentStats,
  useDebouncedValue,
  type WriteNotice
} from './write-workspace-view-utils'
import { buildWritePresentationPrompt, isPresentationMarkdownPath } from '../../write/write-presentation'
import {
  captureWriteDocumentContext,
  writeDocumentContextMatches,
  type WriteDocumentContext
} from '../../write/write-document-context'
import { enqueueWriteWorkspaceFileTask } from '../../write/write-save-coordinator'
import {
  isWriteFocusModeFormControl,
  writeFocusModeFloatingLayerClassName,
  writeFocusModeShellClassName
} from '../../write/write-focus-mode'
import {
  getWriteOnboardingDecision,
  readWriteOnboardingComplete,
  writeWriteOnboardingComplete
} from '../../write/write-onboarding'

type Props = {
  leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void
  input: string; setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  onOpenAgentSettings?: () => void
}

export function WriteWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onOpenAgentSettings
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const busy = useChatStore((s) => s.busy)
  // Field-level subscription: this view must follow fileContent, but it should
  // not re-render for sidebar-only state such as the directory tree or quoted
  // selections.
  const {
    defaultWorkspaceRoot,
    workspaceRoots,
    settingsLoading,
    settingsError,
    workspaceRoot,
    activeFilePath,
    activeFileKind,
    documentEpoch,
    autoSaveEnabled,
    autoSaveDelayMs,
    rootDirectory,
    entriesByDir,
    loadingDirs,
    treeError,
    inlineCompletion,
    inlineCompletionApiReady,
    selectionAssist,
    imageGenReady,
    fileContent,
    imageDataUrl,
    imageMimeType,
    pdfDataBase64,
    pdfMimeType,
    pdfMtimeMs,
    fileSize,
    fileTruncated,
    fileError,
    fileLoading,
    saveStatus,
    previewMode,
    assistantOpen,
    selection,
    recentEdits,
    loadWriteSettings,
    setInlineCompletionEnabled,
    addWriteWorkspace,
    setFileContent,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    flushSave,
    createFile,
    refreshWorkspace,
    setFileError,
    setPreviewMode,
    setAssistantOpen,
    setSelection,
    recordRecentEdits,
    quoteCurrentSelection,
    agentPresets,
    assistantAgentPresetId,
    setAssistantAgentPresetId,
    pendingAgentReview,
    clearPendingAgentReview,
    reviewActive,
    setReviewActive
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      defaultWorkspaceRoot: s.defaultWorkspaceRoot,
      workspaceRoots: s.workspaceRoots,
      settingsLoading: s.settingsLoading,
      settingsError: s.settingsError,
      workspaceRoot: s.workspaceRoot,
      activeFilePath: s.activeFilePath,
      activeFileKind: s.activeFileKind,
      documentEpoch: s.documentEpoch,
      autoSaveEnabled: s.autoSaveEnabled,
      autoSaveDelayMs: s.autoSaveDelayMs,
      rootDirectory: s.rootDirectory,
      entriesByDir: s.entriesByDir,
      loadingDirs: s.loadingDirs,
      treeError: s.treeError,
      inlineCompletion: s.inlineCompletion,
      inlineCompletionApiReady: s.inlineCompletionApiReady,
      selectionAssist: s.selectionAssist,
      agentPresets: s.agentPresets,
      assistantAgentPresetId: s.assistantAgentPresetId,
      setAssistantAgentPresetId: s.setAssistantAgentPresetId,
      pendingAgentReview: s.pendingAgentReview,
      clearPendingAgentReview: s.clearPendingAgentReview,
      reviewActive: s.reviewActive,
      setReviewActive: s.setReviewActive,
      imageGenReady: s.imageGenReady,
      fileContent: s.fileContent,
      imageDataUrl: s.imageDataUrl,
      imageMimeType: s.imageMimeType,
      pdfDataBase64: s.pdfDataBase64,
      pdfMimeType: s.pdfMimeType,
      pdfMtimeMs: s.pdfMtimeMs,
      fileSize: s.fileSize,
      fileTruncated: s.fileTruncated,
      fileError: s.fileError,
      fileLoading: s.fileLoading,
      saveStatus: s.saveStatus,
      previewMode: s.previewMode,
      assistantOpen: s.assistantOpen,
      selection: s.selection,
      recentEdits: s.recentEdits,
      loadWriteSettings: s.loadWriteSettings,
      setInlineCompletionEnabled: s.setInlineCompletionEnabled,
      addWriteWorkspace: s.addWriteWorkspace,
      setFileContent: s.setFileContent,
      syncActiveFileFromDisk: s.syncActiveFileFromDisk,
      syncActiveImageFromDisk: s.syncActiveImageFromDisk,
      flushSave: s.flushSave,
      createFile: s.createFile,
      refreshWorkspace: s.refreshWorkspace,
      setFileError: s.setFileError,
      setPreviewMode: s.setPreviewMode,
      setAssistantOpen: s.setAssistantOpen,
      setSelection: s.setSelection,
      recordRecentEdits: s.recordRecentEdits,
      quoteCurrentSelection: s.quoteCurrentSelection
    }))
  )
  const saveTimerRef = useRef<number | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const previewPaneRef = useRef<HTMLDivElement | null>(null)
  const exportNoticeTimerRef = useRef<number | null>(null)
  const inlineAgentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const richHandleRef = useRef<WriteRichEditorHandle | null>(null)
  const markdownHandleRef = useRef<WriteMarkdownEditorHandle | null>(null)
  const [inlineAgentValue, setInlineAgentValue] = useState('')
  const [pointerSelecting, setPointerSelecting] = useState(false)
  const [inlineAgentFocused, setInlineAgentFocused] = useState(false)
  const selectionBeforeFocusRef = useRef<WriteEditorSelectionState | null>(null)
  const resolvedAgentPresets = agentPresets.map((preset) => resolveWriteAgentPreset(preset))
  const [inlineEditInFlight, setInlineEditInFlight] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [documentFocusMode, setDocumentFocusMode] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | typeof WRITE_RICH_CLIPBOARD_ACTION | null>(null)
  const [exportNotice, setExportNotice] = useState<WriteNotice | null>(null)
  const [presentationInFlight, setPresentationInFlight] = useState(false)
  const [onboardingComplete, setOnboardingComplete] = useState(readWriteOnboardingComplete)
  const workspaceReady = workspaceRoot.trim().length > 0
  const activeFileIsImage = activeFileKind === 'image'
  const activeFileIsPdf = activeFileKind === 'pdf'
  const activeFileIsText = activeFileKind === 'text'
  const isMarkdown = activeFilePath && activeFileIsText ? isMarkdownFile(activeFilePath) : true
  const isPresentationSource = activeFileIsText && isPresentationMarkdownPath(activeFilePath)
  const renderSafety = getWriteRenderSafety({
    isMarkdown,
    contentLength: fileContent.length,
    fileSize,
    truncated: fileTruncated
  })
  const toggleInlineCompletion = useCallback((): void => {
    const writeState = useWriteWorkspaceStore.getState()
    void writeState.setInlineCompletionEnabled(!writeState.inlineCompletion.enabled)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !activeFileIsText ||
        renderSafety.readOnly ||
        isWriteFocusModeFormControl(event.target) ||
        !isInlineCompletionToggleShortcut(event)
      ) return
      event.preventDefault()
      toggleInlineCompletion()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFileIsText, renderSafety.readOnly, toggleInlineCompletion])
  const debouncedPreviewContent = useDebouncedValue(fileContent, writePreviewDebounceMs(fileContent.length))
  const saveLabel = activeFileIsImage
    ? t('writeImagePreview')
    : activeFileIsPdf ? t('writePdfPreview')
    : renderSafety.readOnly ? t('writeReadOnly') : formatSaveLabel(saveStatus, t)
  // When the inline agent textarea is focused the editor loses focus and may
  // report an empty selection (TipTap fires onSelectionUpdate on blur). Use
  // the selection captured at focus-time so the toolbar stays visible while
  // the user types their prompt.
  const effectiveSelection =
    inlineAgentFocused && selectionBeforeFocusRef.current ? selectionBeforeFocusRef.current : selection
  // Only surface the toolbar once the selection gesture settles: while the
  // pointer is down (dragging to select) it stays hidden to avoid flicker.
  const selectionAction =
    effectiveSelection.charCount > 0 && !pointerSelecting ? inlineAgentPosition(effectiveSelection, { compact: activeFileIsPdf }) : null
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const activeFileName = activeFilePath ? writeBasenameFromPath(activeFilePath) : t('writeStudio')
  const documentStats = useMemo(
    () => (activeFileIsText ? computeWriteDocumentStats(fileContent, isMarkdown) : null),
    [activeFileIsText, fileContent, isMarkdown],
  )
  const documentStatsLabel = documentStats
    ? t('writeDocumentStats', {
        words: documentStats.wordCount,
        characters: documentStats.characterCount
      })
    : null
  const workspacePathLabel = rootDirectory || workspaceRoot
  const workspaceName = workspacePathLabel ? writeBasenameFromPath(workspacePathLabel) : t('writeWorkspace')
  const onboardingDecision = useMemo(() => getWriteOnboardingDecision({
    persistedComplete: onboardingComplete,
    settingsLoading,
    defaultWorkspaceRoot,
    workspaceRoots,
    workspaceRoot,
    rootDirectory,
    entriesByDir,
    loadingDirs,
    activeFilePath
  }), [
    activeFilePath,
    defaultWorkspaceRoot,
    entriesByDir,
    loadingDirs,
    onboardingComplete,
    rootDirectory,
    settingsLoading,
    workspaceRoot,
    workspaceRoots
  ])
  const exportInFlight = exportingFormat !== null
  const presentationEnabled = Boolean(
    workspaceReady &&
    activeFilePath &&
    isPresentationSource &&
    !fileLoading &&
    !fileTruncated &&
    !renderSafety.readOnly &&
    !reviewActive &&
    !busy
  )
  const fileGuardMessage = renderSafety.notice === 'truncated'
    ? t('writeLargeFileTruncated')
    : renderSafety.notice === 'large-file'
      ? t('writeLargeFileSafeMode')
      : ''
  const fileGuardDetail = renderSafety.notice === 'large-file' ? t('writeLargeFileSafeModeSub') : ''

  useWriteSplitScrollSync({
    enabled: workspaceReady && previewMode === 'split' && activeFileIsText,
    editorRootRef: editorPaneRef,
    previewRef: previewPaneRef,
    rebindKey: activeFilePath ?? 'write-preview'
  })

  useWriteWorkspaceLifecycle({
    workspaceRoot,
    activeFilePath,
    activeFileIsText,
    activeFileIsImage,
    autoSaveEnabled,
    autoSaveDelayMs,
    fileContent,
    saveStatus,
    workspaceReady,
    readOnly: renderSafety.readOnly,
    reviewActive,
    pendingAgentReview,
    reviewSurfaceKey: previewMode,
    saveTimerRef,
    markdownHandleRef,
    flushSave,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    setFileContent,
    setFileError,
    clearPendingAgentReview,
    setReviewActive
  })

  const showExportNotice = (notice: WriteNotice): void => {
    setExportNotice(notice)
  }

  const completeOnboarding = useCallback((): void => {
    writeWriteOnboardingComplete()
    setOnboardingComplete(true)
  }, [])

  const createDraftFile = async (): Promise<void> => {
    if (!workspaceReady) {
      await pickWriteWorkspace()
      return
    }
    const root = rootDirectory || workspaceRoot
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = writeJoinPath(root, `draft-${stamp}.md`)
    const created = await createFile(workspaceRoot, path, `# ${t('writeUntitledDraft')}\n\n`)
    if (created) completeOnboarding()
  }

  const setAssistantPrompt = (prompt: string): void => {
    setAssistantOpen(true)
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }

  const generatePresentation = async (): Promise<void> => {
    if (!presentationEnabled || !activeFilePath || presentationInFlight) return

    const sourcePath = activeFilePath
    const sourceWorkspace = workspaceRoot
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    setPresentationInFlight(true)
    try {
      if (!await flushSave(sourceWorkspace)) {
        showExportNotice({ tone: 'error', message: t('writePptSaveFailed') })
        return
      }
      if (typeof window.kunGui?.ensurePptMaster !== 'function') {
        showExportNotice({ tone: 'error', message: t('writePptUnavailable') })
        return
      }

      const ensured = await window.kunGui.ensurePptMaster()
      if (!ensured.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writePptInstallFailed', { message: ensured.message })
        })
        return
      }

      // Installing the skill can take long enough for the user to navigate to
      // another document. Do not silently turn that newly selected file into a
      // presentation; the button always means the file that was clicked.
      const latest = useWriteWorkspaceStore.getState()
      if (latest.workspaceRoot !== sourceWorkspace || latest.activeFilePath !== sourcePath) {
        showExportNotice({ tone: 'error', message: t('writePptSourceChanged') })
        return
      }
      if (!await flushSave(sourceWorkspace)) {
        showExportNotice({ tone: 'error', message: t('writePptSaveFailed') })
        return
      }

      const prompt = buildWritePresentationPrompt({ workspaceRoot: sourceWorkspace, sourcePath })
      setAssistantOpen(true)
      if (onSubmitPrompt) {
        onSubmitPrompt(prompt)
      } else {
        setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
      }
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writePptInstallFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPresentationInFlight(false)
    }
  }

  const handleInlineAgentFocus = useCallback((): void => {
    selectionBeforeFocusRef.current = selection
    setInlineAgentFocused(true)
  }, [selection])

  const handleInlineAgentBlur = useCallback((): void => {
    setInlineAgentFocused(false)
    selectionBeforeFocusRef.current = null
  }, [])

  const submitInlineAgent = (prompt: string): void => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath) return
    // The active agent persona is applied downstream (folded into the prompt
    // context in sendWritePrompt) so it never shows as raw text in the bubble.
    quoteCurrentSelection(workspaceRoot)
    setAssistantOpen(true)
    setInlineAgentValue('')
    if (onSubmitPrompt) {
      onSubmitPrompt(trimmed)
      return
    }
    setInput(input.trim() ? `${input.trim()}\n\n${trimmed}` : trimmed)
  }

  const quoteSelectionToAssistant = (): void => {
    if (!workspaceReady || !activeFilePath) return
    quoteCurrentSelection(workspaceRoot)
    setInlineAgentValue('')
  }

  // Edit-mode quick actions rewrite the selection in place through the
  // inline-edit pipeline; chat-mode actions (润色/解释) quote the selection and
  // hand the prompt to the sidebar assistant (auto-expanding it).
  const runQuickAction = (quickAction: ResolvedWriteQuickAction): void => {
    if (quickAction.mode === 'edit') {
      void submitInlineEdit(quickAction.prompt)
      return
    }
    submitInlineAgent(quickAction.prompt)
  }

  const applyInlineFormat = (kind: WriteInlineFormatKind): void => {
    if (!workspaceReady || !activeFilePath || renderSafety.readOnly) return
    const richHandle = richModeActive ? richHandleRef.current : null
    if (richHandle) {
      richHandle.toggleInlineFormat(kind)
      return
    }
    if (selection.ranges.length !== 1) return
    const range = selection.ranges[0]
    const replacement = toggleWriteInlineFormat(range.text, kind)
    if (replacement === null) return
    markdownHandleRef.current?.applyRangeReplacement(
      { from: range.from, to: range.to },
      range.text,
      replacement
    )
  }

  const applyBlockType = (type: WriteBlockType): void => {
    if (!workspaceReady || !activeFilePath || renderSafety.readOnly) return
    const richHandle = richModeActive ? richHandleRef.current : null
    if (richHandle) {
      // TipTap toggle* commands already turn the active type back to paragraph.
      richHandle.setBlockType(type)
      return
    }
    // Source mode has no toggle built in: re-selecting the active type clears it.
    const effective = selection.blockType === type && type !== 'paragraph' ? 'paragraph' : type
    markdownHandleRef.current?.setBlockType(effective)
  }

  const submitInlineEdit = async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath || inlineEditInFlight) return
    if (renderSafety.readOnly) {
      setFileError(t('writeReadOnlySaveDisabled'))
      return
    }
    if (markdownHandleRef.current?.isDiffReviewActive()) {
      setFileError(t('writeInlineEditReviewPending'))
      return
    }
    if (selection.ranges.length !== 1) {
      setFileError(t(selection.ranges.length > 1 ? 'writeInlineEditMultiSelection' : 'writeInlineEditNoSelection'))
      return
    }
    if (typeof window.kunGui?.requestWriteInlineCompletion !== 'function') {
      setFileError(t('writeInlineEditUnavailable'))
      return
    }
    const operationContext = captureWriteDocumentContext(useWriteWorkspaceStore.getState())
    if (!operationContext) return

    // In rich mode the inline edit operates on the markdown projection: the
    // selection ranges are projection offsets and the replacement is applied
    // through the editor so undo history and node structure stay intact.
    const richHandle = richModeActive ? richHandleRef.current : null
    const richProjectionText = richHandle?.getProjectionText() ?? null
    const editContent = richProjectionText ?? fileContent

    const draft = buildWriteInlineEditDraft(editContent, selection.ranges[0], trimmed, {
      workspaceRoot,
      currentFilePath: activeFilePath,
      model: inlineCompletion.model,
      language: 'markdown',
      recentEdits
    })

    setInlineEditInFlight(true)
    try {
      const result = await window.kunGui.requestWriteInlineCompletion(
        buildWriteInlineEditCompletionRequest(draft.request)
      )
      if (!writeDocumentContextMatches(useWriteWorkspaceStore.getState(), operationContext)) return
      if (!result.ok) {
        setFileError(t('writeInlineEditFailed', { message: result.message }))
        return
      }
      const replacement = result.action?.kind === 'edit'
        ? result.action.replacement
        : result.completion
      // An empty rewrite of non-empty text means the model failed to follow
      // the instruction; applying it would silently delete the selection.
      if (!replacement.trim() && draft.scope.text.trim()) {
        setFileError(t('writeInlineEditEmpty'))
        return
      }

      if (richHandle) {
        const applied = richHandle.applyProjectedReplacement(
          { from: draft.scope.from, to: draft.scope.to },
          draft.scope.text,
          replacement,
          trimmed
        )
        if (!applied) {
          setFileError(t('writeInlineEditChanged'))
          return
        }
        setSelection({ text: '', ranges: [], charCount: 0 })
        setInlineAgentValue('')
        setFileError(null)
        showExportNotice({ tone: 'success', message: t('writeInlineEditApplied') })
        return
      }

      const latest = useWriteWorkspaceStore.getState()
      if (!writeDocumentContextMatches(latest, operationContext) || latest.activeFileKind !== 'text') {
        setFileError(t('writeInlineEditChanged'))
        return
      }
      // The document can shift during the multi-second model call (live-preview
      // normalization, autosave round-trips, …). Re-locate the scope in the
      // latest content instead of hard-failing on a stale offset; only give up
      // when the selected text is gone or no longer unique.
      const baseline = latest.fileContent
      let scopeFrom = draft.scope.from
      let scopeTo = draft.scope.to
      if (baseline.slice(scopeFrom, scopeTo) !== draft.scope.text) {
        const firstMatch = draft.scope.text ? baseline.indexOf(draft.scope.text) : -1
        const unique = firstMatch >= 0 && baseline.indexOf(draft.scope.text, firstMatch + 1) === -1
        if (!unique) {
          setFileError(t('writeInlineEditChanged'))
          return
        }
        scopeFrom = firstMatch
        scopeTo = firstMatch + draft.scope.text.length
      }

      const nextContent = applyWriteInlineEditReplacement(
        baseline,
        { ...draft.scope, from: scopeFrom, to: scopeTo },
        replacement
      )
      const inlineEditRecord = createWriteRecentEdit({
        source: 'inline-edit',
        filePath: activeFilePath,
        from: scopeFrom,
        to: scopeTo,
        deletedText: draft.scope.text,
        insertedText: replacement,
        beforeContext: baseline.slice(Math.max(0, scopeFrom - INLINE_EDIT_RECENT_CONTEXT_CHARS), scopeFrom),
        afterContext: nextContent.slice(
          scopeFrom + replacement.length,
          Math.min(nextContent.length, scopeFrom + replacement.length + INLINE_EDIT_RECENT_CONTEXT_CHARS)
        ),
        instruction: trimmed,
        scopeKind: draft.scope.kind
      })

      // Land the rewrite as an inline red/green diff review when the editor
      // supports it (source/live CodeMirror); fall back to a direct apply
      // (rich mode, or no handle) otherwise.
      const startedReview = markdownHandleRef.current?.beginDiffReview({
        original: baseline,
        nextDoc: nextContent
      }) ?? false
      if (!startedReview) {
        setFileContent(nextContent)
        if (inlineEditRecord) recordRecentEdits([inlineEditRecord])
      }
      setSelection({ text: '', ranges: [], charCount: 0 })
      setInlineAgentValue('')
      setFileError(null)
      showExportNotice({
        tone: 'success',
        message: startedReview ? t('writeInlineEditReview') : t('writeInlineEditApplied')
      })
    } catch (error) {
      if (writeDocumentContextMatches(useWriteWorkspaceStore.getState(), operationContext)) {
        setFileError(t('writeInlineEditFailed', {
          message: error instanceof Error ? error.message : String(error)
        }))
      }
    } finally {
      setInlineEditInFlight(false)
    }
  }

  // Inserts an animated placeholder right away and resolves it in the
  // background, so generation never blocks the editor.
  const generateInfographic = (): void => {
    if (!workspaceReady || !activeFilePath) return
    if (renderSafety.readOnly) {
      setFileError(t('writeReadOnlySaveDisabled'))
      return
    }
    if (selection.ranges.length !== 1 || !selection.text.trim()) {
      setFileError(t('writeInlineEditNoSelection'))
      return
    }
    if (typeof window.kunGui?.generateWriteInfographic !== 'function') {
      setFileError(t('writeInfographicUnavailable'))
      return
    }
    const range = selection.ranges[0]
    const richHandle = richModeActive ? richHandleRef.current : null
    const filePath = activeFilePath
    const operationContext = captureWriteDocumentContext(useWriteWorkspaceStore.getState())
    if (!operationContext) return
    const text = selection.text.trim().slice(0, WRITE_INFOGRAPHIC_MAX_TEXT_CHARS)
    const pending = beginPendingInfographic()
    const pendingMarkdown = buildPendingInfographicMarkdown(t('writeInfographicAlt'), pending.src)
    const insertion = `\n\n${pendingMarkdown}\n`
    if (richHandle) {
      // Rich mode: insert at a projection offset so undo history and node
      // structure stay intact.
      const projection = richHandle.getProjectionText() ?? ''
      const insertAt = lineEndAfter(projection, range.to)
      const applied = richHandle.applyProjectedReplacement(
        { from: insertAt, to: insertAt },
        '',
        insertion,
        t('writeInfographicGenerate')
      )
      if (!applied) {
        finishPendingInfographic(pending.id)
        setFileError(t('writeInlineEditChanged'))
        return
      }
    } else {
      const latest = useWriteWorkspaceStore.getState()
      if (
        latest.activeFilePath !== filePath ||
        latest.activeFileKind !== 'text' ||
        latest.fileContent.slice(range.from, range.to) !== range.text
      ) {
        finishPendingInfographic(pending.id)
        setFileError(t('writeInlineEditChanged'))
        return
      }
      const insertAt = lineEndAfter(latest.fileContent, range.to)
      setFileContent(
        latest.fileContent.slice(0, insertAt) + insertion + latest.fileContent.slice(insertAt)
      )
    }
    setSelection({ text: '', ranges: [], charCount: 0 })
    setFileError(null)
    void completeInfographicGeneration({
      id: pending.id,
      src: pending.src,
      pendingMarkdown,
      filePath,
      context: operationContext,
      text
    })
  }

  const completeInfographicGeneration = async (job: {
    id: string
    src: string
    pendingMarkdown: string
    filePath: string
    context: WriteDocumentContext
    text: string
  }): Promise<void> => {
    let replacementMarkdown: string | null = null
    let failureMessage: string | null = null
    try {
      const result = await window.kunGui.generateWriteInfographic({
        text: job.text,
        filePath: job.filePath,
        workspaceRoot: job.context.workspaceRoot
      })
      if (result.ok) {
        replacementMarkdown = `![${t('writeInfographicAlt')}](${result.relativePath})`
      } else {
        failureMessage = result.message
      }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
    } finally {
      finishPendingInfographic(job.id)
    }

    const applied = await resolveInfographicPlaceholder(job, replacementMarkdown)
    if (failureMessage) {
      if (writeDocumentContextMatches(useWriteWorkspaceStore.getState(), job.context)) {
        setFileError(t('writeInfographicFailed', { message: failureMessage }))
      }
    } else if (applied) {
      showExportNotice({ tone: 'success', message: t('writeInfographicReady') })
    }
  }

  /** Swap the placeholder for the generated image — or remove it when
   * `replacementMarkdown` is null. Returns false when the placeholder is
   * gone (the user deleted it, which cancels the insertion). */
  const resolveInfographicPlaceholder = async (
    job: {
      src: string
      pendingMarkdown: string
      filePath: string
      context: WriteDocumentContext
    },
    replacementMarkdown: string | null
  ): Promise<boolean> => {
    const latest = useWriteWorkspaceStore.getState()
    if (writeDocumentContextMatches(latest, job.context) && latest.activeFileKind === 'text') {
      // Node-level swap keeps the rich editor's undo history clean; the text
      // fallback covers the source editor (no rich handle mounted).
      const handle = richHandleRef.current
      if (handle?.replaceImageBySrc(job.src, replacementMarkdown ?? '')) return true
      const next = replacePendingInfographicInText(
        latest.fileContent,
        job.pendingMarkdown,
        replacementMarkdown
      )
      if (next === null) return false
      setFileContent(next)
      return true
    }
    if (
      latest.activeFileKind === 'text' &&
      latest.workspaceRoot === job.context.workspaceRoot &&
      latest.activeFilePath === job.filePath
    ) {
      // The same path was reopened while generation was in flight. Resolve
      // only the unique placeholder in the newly opened content; never write
      // a stale whole-document snapshot over that newer epoch.
      const next = replacePendingInfographicInText(
        latest.fileContent,
        job.pendingMarkdown,
        replacementMarkdown
      )
      if (next === null) return false
      setFileContent(next)
      return true
    }
    // The document was switched away mid-generation; opening another file
    // flushed it to disk with the placeholder inside, so patch it on disk.
    if (
      typeof window.kunGui?.readWorkspaceFile !== 'function' ||
      typeof window.kunGui?.writeWorkspaceFile !== 'function'
    ) {
      return false
    }
    try {
      return await enqueueWriteWorkspaceFileTask(
        job.context.workspaceRoot,
        job.filePath,
        async () => {
          const file = await window.kunGui.readWorkspaceFile({
            path: job.filePath,
            workspaceRoot: job.context.workspaceRoot
          })
          if (!file.ok || file.truncated) return false
          const next = replacePendingInfographicInText(
            file.content,
            job.pendingMarkdown,
            replacementMarkdown
          )
          if (next === null) return false
          const written = await window.kunGui.writeWorkspaceFile({
            path: job.filePath,
            workspaceRoot: job.context.workspaceRoot,
            content: next
          })
          return written.ok
        }
      )
    } catch {
      return false
    }
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(workspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (pathsEqual(useWriteWorkspaceStore.getState().workspaceRoot, picked.path)) {
          completeOnboarding()
          if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
        }
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const exportCurrentFile = async (format: WriteExportFormat): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.kunGui?.exportWriteDocument !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeExportUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(format)
    try {
      const result = await window.kunGui.exportWriteDocument({
        path: activeFilePath,
        workspaceRoot,
        format,
        content: fileContent
      })
      if (!result.ok) {
        if (!result.canceled) {
          showExportNotice({
            tone: 'error',
            message: t('writeExportFailed', {
              format: exportFormatLabel(format, t),
              message: result.message
            })
          })
        }
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeExportSuccess', { format: exportFormatLabel(format, t) })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeExportFailed', {
          format: exportFormatLabel(format, t),
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  const copyCurrentFileAsRichText = async (): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.kunGui?.copyWriteDocumentAsRichText !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeCopyRichTextUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(WRITE_RICH_CLIPBOARD_ACTION)
    try {
      const result = await window.kunGui.copyWriteDocumentAsRichText({
        path: activeFilePath,
        workspaceRoot,
        content: fileContent
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writeCopyRichTextFailed', {
            message: result.message
          })
        })
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeCopyRichTextSuccess')
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeCopyRichTextFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    if (!onboardingComplete && onboardingDecision === 'complete') {
      completeOnboarding()
    }
  }, [completeOnboarding, onboardingComplete, onboardingDecision])

  useEffect(() => {
    setExportMenuOpen(false)
  }, [activeFilePath])

  useEffect(() => {
    setModeMenuOpen(false)
  }, [activeFilePath, previewMode])

  // Reset the AI-edit draft whenever the selection changes; the menu input is
  // always present (no open/close toggle) and must not carry stale text over.
  useEffect(() => {
    setInlineAgentValue('')
  }, [selection.charCount, selection.text])

  // Hide the toolbar while a pointer drag is selecting text inside the editor;
  // it reappears on pointer release once the selection has settled.
  useEffect(() => {
    const handleDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editorPaneRef.current?.contains(target)) {
        setPointerSelecting(true)
      }
    }
    const handleUp = (): void => setPointerSelecting(false)
    window.addEventListener('pointerdown', handleDown)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  useEffect(() => {
    if (!exportMenuOpen && !modeMenuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        exportMenuRef.current &&
        target instanceof Node &&
        !exportMenuRef.current.contains(target)
      ) {
        setExportMenuOpen(false)
      }
      if (
        modeMenuRef.current &&
        target instanceof Node &&
        !modeMenuRef.current.contains(target)
      ) {
        setModeMenuOpen(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setExportMenuOpen(false)
      setModeMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen, modeMenuOpen])

  useEffect(() => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    if (!exportNotice) return
    exportNoticeTimerRef.current = window.setTimeout(() => {
      exportNoticeTimerRef.current = null
      setExportNotice(null)
    }, WRITE_EXPORT_NOTICE_MS)
    return () => {
      if (exportNoticeTimerRef.current) {
        window.clearTimeout(exportNoticeTimerRef.current)
        exportNoticeTimerRef.current = null
      }
    }
  }, [exportNotice])

  useEffect(() => () => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
  }, [])

  if (!workspaceReady) {
    return (
      <WriteWorkspaceEmptyState
        error={settingsError ?? treeError ?? fileError}
        onPickWorkspace={() => void pickWriteWorkspace()}
      />
    )
  }

  const editorVisible = activeFileIsText && previewMode !== 'preview'
  const previewVisible = activeFileIsText && (previewMode === 'split' || previewMode === 'preview')
  const editorWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2 border-r border-ds-border-muted'
    : 'min-w-0 flex-1'
  const previewWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2'
    : 'min-w-0 flex-1'
  // Edit-mode quick actions rewrite the document, so drop them on read-only
  // files; chat-mode actions (which only quote into the sidebar) still apply.
  const inlineQuickActions = resolveWriteQuickActions(selectionAssist.quickActions, t).filter(
    (quickAction) => quickAction.mode !== 'edit' || (activeFileIsText && !renderSafety.readOnly)
  )
  const richModeActive =
    previewMode === 'rich' && isMarkdown && renderSafety.livePreviewEnabled && activeFileIsText
  const liveModeActive = previewMode === 'live' && renderSafety.livePreviewEnabled
  const sourceModeActive =
    previewMode === 'source' ||
    ((previewMode === 'live' || previewMode === 'rich') && !renderSafety.livePreviewEnabled) ||
    (previewMode === 'rich' && !richModeActive)
  const editorAppearance = sourceModeActive ? 'source' : 'live'

  const modeMenuItems: Array<{ mode: WritePreviewMode; label: string; shortLabel: string; icon: ReactElement; active: boolean }> = [
    {
      mode: 'rich',
      label: t('writeModeRich'),
      shortLabel: t('writeModeRich'),
      icon: <Type className="h-4 w-4" strokeWidth={1.85} />,
      active: richModeActive
    },
    {
      mode: 'source',
      label: t('writeModeSource'),
      shortLabel: t('writeModeSource'),
      icon: <FileCode2 className="h-4 w-4" strokeWidth={1.85} />,
      active: sourceModeActive
    },
    {
      mode: 'split',
      label: t('writeModeSplit'),
      shortLabel: t('writeModeSplit'),
      icon: <Columns2 className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'split'
    },
    {
      mode: 'preview',
      label: t('writeModePreview'),
      shortLabel: t('writeModePreview'),
      icon: <Eye className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'preview'
    }
  ]

  return (
    <div className={`write-workspace-view ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 sm:px-4 md:px-6 lg:px-8 ${documentFocusMode ? 'is-focus-mode' : ''}`}>
      <WriteWorkspaceToolbar
        activeFileIsImage={activeFileIsImage}
        activeFileIsPdf={activeFileIsPdf}
        activeFileIsText={activeFileIsText}
        activeFileLabel={activeFileLabel}
        activeFileName={activeFileName}
        activeFilePath={activeFilePath ?? ''}
        documentStatsLabel={documentStatsLabel}
        inlineCompletionEnabled={inlineCompletion.enabled}
        assistantOpen={assistantOpen}
        exportInFlight={exportInFlight}
        exportMenuOpen={exportMenuOpen}
        exportMenuRef={exportMenuRef}
        leftSidebarCollapsed={leftSidebarCollapsed}
        liveModeActive={liveModeActive}
        modeMenuItems={modeMenuItems}
        modeMenuOpen={modeMenuOpen}
        modeMenuRef={modeMenuRef}
        previewMode={previewMode}
        presentationEnabled={presentationEnabled}
        presentationInFlight={presentationInFlight}
        readOnly={renderSafety.readOnly}
        saveLabel={saveLabel}
        saveStatus={saveStatus}
        reviewActive={reviewActive}
        setAssistantOpen={setAssistantOpen}
        setExportMenuOpen={setExportMenuOpen}
        setModeMenuOpen={setModeMenuOpen}
        setPreviewMode={setPreviewMode}
        onCopyRichText={() => void copyCurrentFileAsRichText()}
        onExportFile={(format) => void exportCurrentFile(format)}
        onGeneratePresentation={() => void generatePresentation()}
        onSave={() => {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          void flushSave(workspaceRoot, { resolveExternalConflict: 'keep-local' })
        }}
        onToggleInlineCompletion={toggleInlineCompletion}
        onToggleLeftSidebar={onToggleLeftSidebar}
      />
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden pb-3 pt-3">
        <div className={writeFocusModeShellClassName(documentFocusMode)}>
          <WriteWorkspaceDocumentPane
            activeFilePath={activeFilePath}
            documentEpoch={documentEpoch}
            activeFileIsImage={activeFileIsImage}
            activeFileIsPdf={activeFileIsPdf}
            activeFileIsText={activeFileIsText}
            fileLoading={fileLoading}
            fileContent={fileContent}
            imageDataUrl={imageDataUrl}
            imageMimeType={imageMimeType}
            pdfDataBase64={pdfDataBase64}
            pdfMimeType={pdfMimeType}
            pdfMtimeMs={pdfMtimeMs}
            fileSize={fileSize}
            workspaceRoot={workspaceRoot}
            workspaceName={workspaceName}
            workspacePathLabel={workspacePathLabel}
            workspaceError={settingsError ?? treeError}
            renderSafety={renderSafety}
            fileGuardMessage={fileGuardMessage}
            fileGuardDetail={fileGuardDetail}
            editorVisible={editorVisible}
            previewVisible={previewVisible}
            editorWidth={editorWidth}
            previewWidth={previewWidth}
            editorAppearance={editorAppearance}
            richModeActive={richModeActive}
            richHandleRef={richHandleRef}
            markdownHandleRef={markdownHandleRef}
            onMarkdownReviewStateChange={setReviewActive}
            focusMode={documentFocusMode}
            onFocusModeChange={setDocumentFocusMode}
            onboarding={onboardingDecision === 'show'}
            workspaceLoading={
              onboardingDecision === 'pending' && !settingsError && !treeError
            }
            debouncedPreviewContent={debouncedPreviewContent}
            isMarkdown={isMarkdown}
            inlineCompletion={inlineCompletion}
            inlineCompletionApiReady={inlineCompletionApiReady}
            recentEdits={recentEdits}
            editorPaneRef={editorPaneRef}
            previewPaneRef={previewPaneRef}
            onAskAssistant={() => setAssistantPrompt(t('writeStartAskAiPrompt'))}
            onCreateDraft={() => void createDraftFile()}
            onPickWorkspace={() => void pickWriteWorkspace()}
            onRefreshWorkspace={() => void refreshWorkspace(workspaceRoot)}
            onContentChange={setFileContent}
            onDocumentEdit={recordRecentEdits}
            onSelectionChange={setSelection}
            onSaveShortcut={() => {
              if (renderSafety.readOnly) return
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
              void flushSave(workspaceRoot, { resolveExternalConflict: 'keep-local' })
            }}
            onImagePasteSaved={() => {
              setFileError(null)
              void refreshWorkspace(workspaceRoot)
            }}
            onImagePasteError={(message) => setFileError(message)}
          />
        </div>

      </div>
      {selectionAction && activeFilePath && (activeFileIsText || activeFileIsPdf) ? (
        <WriteInlineAgent
          action={selectionAction}
          value={inlineAgentValue}
          inFlight={inlineEditInFlight}
          textareaRef={inlineAgentTextareaRef}
          onValueChange={setInlineAgentValue}
          onSubmitPrompt={submitInlineAgent}
          onApplyEdit={(value) => activeFileIsPdf ? submitInlineAgent(value) : void submitInlineEdit(value)}
          askOnly={activeFileIsPdf}
          preferAbove={activeFileIsPdf}
          formattingEnabled={activeFileIsText && isMarkdown && !renderSafety.readOnly}
          onApplyFormat={applyInlineFormat}
          blockType={effectiveSelection.blockType}
          onSetBlockType={applyBlockType}
          quickActions={inlineQuickActions}
          onQuickAction={runQuickAction}
          onQuoteSelection={quoteSelectionToAssistant}
          agentPresets={resolvedAgentPresets}
          activeAgentId={assistantAgentPresetId}
          onSelectAgent={setAssistantAgentPresetId}
          onOpenAgentSettings={onOpenAgentSettings}
          infographicEnabled={activeFileIsText && imageGenReady && isMarkdown && !renderSafety.readOnly}
          onGenerateInfographic={generateInfographic}
          onTextareaFocus={handleInlineAgentFocus}
          onTextareaBlur={handleInlineAgentBlur}
          focusMode={documentFocusMode}
        />
      ) : null}

      {fileError ? (
        <div className={`pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(20,47,95,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200 ${writeFocusModeFloatingLayerClassName(documentFocusMode, 'z-40')}`}>
          {fileError}
        </div>
      ) : null}
      {exportNotice ? (
        <div
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] shadow-[0_14px_32px_rgba(20,47,95,0.12)] ${writeFocusModeFloatingLayerClassName(documentFocusMode, 'z-40')} ${
            exportNotice.tone === 'error'
              ? 'border-red-200/70 bg-red-50/92 text-red-700 dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200'
              : 'border-emerald-200/80 bg-emerald-50/92 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/84 dark:text-emerald-200'
          }`}
          style={{ bottom: fileError ? 68 : 20 }}
        >
          {exportNotice.message}
        </div>
      ) : null}
    </div>
  )
}
