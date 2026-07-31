import i18n from '../i18n'
import { isWriteImageFilePath, isWritePdfFilePath, isWriteWorkspaceFilePath } from '@shared/write-text-file'
import { writePathToFileUrl } from '@shared/write-markdown-resource'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import { nextWriteDocumentEpoch } from './write-document-context'
import {
  emptySelection,
  filterWriteEntries,
  formatWriteImageLoadError,
  imageMimeTypeFromPath,
  initialState,
  isMissingImageIpc,
  normalizePath,
  readRememberedActiveFile,
  rememberActiveFile,
  writeDirnameFromPath
} from './write-workspace-store-helpers'
import {
  forgetWriteFileThreads,
  moveWriteFileThreads,
  saveWriteThreadRegistry
} from './write-thread-registry'

type WriteFileActions = Pick<
  WriteWorkspaceState,
  | 'initializeWorkspace'
  | 'loadDirectory'
  | 'toggleDirectory'
  | 'refreshWorkspace'
  | 'openFile'
  | 'createFile'
  | 'createDirectory'
  | 'renameEntry'
  | 'deleteEntry'
>

type WriteFileActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
  cancelExternalSyncAnimation: () => void
}

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extensionFromWritePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const slash = normalized.lastIndexOf('/')
  const dot = normalized.lastIndexOf('.')
  return dot > slash ? normalized.slice(dot) : ''
}

function ensureMarkdownRenameExtension(path: string, newName: string): string {
  if (extensionFromWritePath(newName)) return newName
  const currentExtension = extensionFromWritePath(path)
  return /^(?:\.md|\.markdown|\.mdx)$/i.test(currentExtension)
    ? `${newName}${currentExtension.toLowerCase()}`
    : newName
}

function withoutLoadingDirs(
  loadingDirs: Record<string, boolean>,
  keys: Array<string | undefined>
): Record<string, boolean> {
  const next = { ...loadingDirs }
  for (const key of keys) {
    if (key) delete next[key]
  }
  return next
}

async function prepareActiveFileForNavigation(
  get: WriteWorkspaceGet,
  workspaceRoot: string
): Promise<boolean> {
  const state = get()
  if (!state.activeFilePath || state.activeFileKind !== 'text') return true
  if (state.autoSaveEnabled) return get().flushSave(workspaceRoot)
  if (state.saveStatus !== 'dirty' && state.saveStatus !== 'error') return true
  return window.confirm(i18n.t('common:writeDiscardUnsavedChangesConfirm'))
}

export function createWriteFileActions({
  set,
  get,
  cancelExternalSyncAnimation
}: WriteFileActionContext): WriteFileActions {
  let navigationGeneration = 0
  const directoryRequestGenerations = new Map<string, number>()
  const nextNavigationGeneration = (): number => {
    navigationGeneration += 1
    return navigationGeneration
  }
  const navigationIsCurrent = (generation: number, workspaceRoot?: string): boolean => {
    if (generation !== navigationGeneration) return false
    if (!workspaceRoot) return true
    const activeRoot = normalizePath(get().workspaceRoot)
    return !activeRoot || activeRoot === normalizePath(workspaceRoot)
  }
  const workspaceIsCurrent = (workspaceRoot: string): boolean => {
    const activeRoot = normalizePath(get().workspaceRoot)
    return !activeRoot || activeRoot === normalizePath(workspaceRoot)
  }

  return {
    initializeWorkspace: async (workspaceRoot) => {
      const generation = nextNavigationGeneration()
      const normalized = normalizePath(workspaceRoot.trim())
      if (!normalized) {
        cancelExternalSyncAnimation()
        set((state) => ({
          ...initialState(),
          documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
        }))
        return
      }
      const current = get()
      if (current.workspaceRoot === normalized && current.rootDirectory) {
        await get().refreshWorkspace(normalized)
        return
      }
      if (current.workspaceRoot && current.workspaceRoot !== normalized) {
        const canLeaveCurrentFile = await prepareActiveFileForNavigation(get, current.workspaceRoot)
        if (!canLeaveCurrentFile || generation !== navigationGeneration) return
      }

      cancelExternalSyncAnimation()
      set((state) => ({
        ...initialState(),
        workspaceRoot: normalized,
        documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
      }))
      const root = await get().loadDirectory(normalized)
      if (!root || !navigationIsCurrent(generation, normalized)) return
      set((state) => ({ rootDirectory: root, expandedDirs: new Set([...state.expandedDirs, root]) }))
      const remembered = readRememberedActiveFile(normalized)
      if (remembered.trim() && isWriteWorkspaceFilePath(remembered)) {
        await get().openFile(normalized, remembered)
      } else if (remembered.trim()) {
        rememberActiveFile(normalized, null)
      }
    },

    loadDirectory: async (workspaceRoot, path) => {
      const requestedWorkspace = normalizePath(workspaceRoot)
      const requestedRoot = normalizePath(path || workspaceRoot)
      const targetKey = path ? requestedRoot : '__root__'
      const requestKey = `${requestedWorkspace}\0${requestedRoot}`
      const requestGeneration = (directoryRequestGenerations.get(requestKey) ?? 0) + 1
      directoryRequestGenerations.set(requestKey, requestGeneration)
      const requestIsCurrent = (): boolean =>
        directoryRequestGenerations.get(requestKey) === requestGeneration && workspaceIsCurrent(workspaceRoot)
      set((state) => ({ loadingDirs: { ...state.loadingDirs, [targetKey]: true } }))
      let result: Awaited<ReturnType<typeof window.kunGui.listWorkspaceDirectory>>
      try {
        result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        if (!requestIsCurrent()) return null
        set((state) => ({
          loadingDirs: withoutLoadingDirs(state.loadingDirs, [targetKey, requestedRoot]),
          treeError: formatActionError(error)
        }))
        return null
      }
      if (!requestIsCurrent()) return null
      set((state) => {
        const loadingDirs = withoutLoadingDirs(state.loadingDirs, [
          targetKey,
          requestedRoot,
          result.ok ? result.root : undefined
        ])
        return { loadingDirs }
      })
      if (!result.ok) {
        set({ treeError: result.message })
        return null
      }
      const visibleEntries = filterWriteEntries(result.entries)
      set((state) => {
        const entriesByDir = { ...state.entriesByDir, [result.root]: visibleEntries }
        if (requestedRoot && requestedRoot !== result.root) {
          entriesByDir[requestedRoot] = visibleEntries
        }
        const expandedDirs = new Set(state.expandedDirs)
        if (!path) expandedDirs.add(result.root)
        return {
          treeError: null,
          rootDirectory: !path && !state.rootDirectory ? result.root : state.rootDirectory,
          expandedDirs,
          entriesByDir
        }
      })
      return result.root
    },

    toggleDirectory: async (workspaceRoot, path) => {
      const expanded = get().expandedDirs.has(path)
      if (!expanded && !get().entriesByDir[path]) {
        await get().loadDirectory(workspaceRoot, path)
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        if (expandedDirs.has(path)) {
          expandedDirs.delete(path)
        } else {
          expandedDirs.add(path)
        }
        return { expandedDirs }
      })
    },

    refreshWorkspace: async (workspaceRoot) => {
      const state = get()
      const root = state.rootDirectory || await get().loadDirectory(workspaceRoot)
      if (!root) return
      if (!state.rootDirectory) {
        set((latest) => ({ rootDirectory: root, expandedDirs: new Set([...latest.expandedDirs, root]) }))
      }
      const latest = get()
      const targets = new Set([root, ...latest.expandedDirs])
      await Promise.all([...targets].map((dirPath) => get().loadDirectory(workspaceRoot, dirPath)))
    },

    openFile: async (workspaceRoot, path) => {
      const generation = nextNavigationGeneration()
      cancelExternalSyncAnimation()
      if (!isWriteWorkspaceFilePath(path)) {
        set({
          fileLoading: false,
          fileError: i18n.t('common:writeUnsupportedFileType')
        })
        return
      }
      const canLeaveCurrentFile = await prepareActiveFileForNavigation(get, workspaceRoot)
      if (!canLeaveCurrentFile || !navigationIsCurrent(generation, workspaceRoot)) return
      set({ fileLoading: true, fileError: null })
      try {
        if (isWriteImageFilePath(path)) {
          const result = await window.kunGui.readWorkspaceImage({ path, workspaceRoot })
          if (!navigationIsCurrent(generation, workspaceRoot)) return
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
          set((state) => ({
            activeFilePath: result.path,
            activeFileKind: 'image',
            fileContent: '',
            imageDataUrl: result.dataUrl,
            imageMimeType: result.mimeType,
            pdfDataBase64: '',
            pdfMimeType: '',
            pdfMtimeMs: 0,
            fileSize: result.size,
            fileTruncated: false,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch),
            contentRevision: 0,
            persistedContent: '',
            pendingAgentReview: null,
            reviewActive: false,
            selection: emptySelection(),
            quotedSelections: [],
            recentEdits: []
          }))
          return
        }

        if (isWritePdfFilePath(path)) {
          const result = await window.kunGui.readWorkspacePdf({ path, workspaceRoot })
          if (!navigationIsCurrent(generation, workspaceRoot)) return
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
          set((state) => ({
            activeFilePath: result.path,
            activeFileKind: 'pdf',
            fileContent: '',
            imageDataUrl: '',
            imageMimeType: '',
            pdfDataBase64: result.dataBase64,
            pdfMimeType: result.mimeType,
            pdfMtimeMs: result.mtimeMs,
            fileSize: result.size,
            fileTruncated: false,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch),
            contentRevision: 0,
            persistedContent: '',
            pendingAgentReview: null,
            reviewActive: false,
            selection: emptySelection(),
            quotedSelections: [],
            recentEdits: []
          }))
          return
        }

        const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot })
        if (!navigationIsCurrent(generation, workspaceRoot)) return
        if (!result.ok) {
          set({ fileLoading: false, fileError: result.message })
          return
        }
        rememberActiveFile(workspaceRoot, result.path)
        set((state) => ({
          activeFilePath: result.path,
          activeFileKind: 'text',
          fileContent: result.content,
          imageDataUrl: '',
          imageMimeType: '',
          pdfDataBase64: '',
          pdfMimeType: '',
          pdfMtimeMs: 0,
          fileSize: result.size,
          fileTruncated: result.truncated,
          fileLoading: false,
          fileError: null,
          saveStatus: 'saved',
          documentEpoch: nextWriteDocumentEpoch(state.documentEpoch),
          contentRevision: 0,
          persistedContent: result.content,
          pendingAgentReview: null,
          reviewActive: false,
          selection: emptySelection(),
          quotedSelections: [],
          recentEdits: []
        }))
      } catch (error) {
        if (!navigationIsCurrent(generation, workspaceRoot)) return
        if (isWriteImageFilePath(path) && isMissingImageIpc(error)) {
          rememberActiveFile(workspaceRoot, path)
          set((state) => ({
            activeFilePath: path,
            activeFileKind: 'image',
            fileContent: '',
            imageDataUrl: writePathToFileUrl(path),
            imageMimeType: imageMimeTypeFromPath(path),
            pdfDataBase64: '',
            pdfMimeType: '',
            pdfMtimeMs: 0,
            fileSize: 0,
            fileTruncated: false,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch),
            contentRevision: 0,
            persistedContent: '',
            pendingAgentReview: null,
            reviewActive: false,
            selection: emptySelection(),
            quotedSelections: [],
            recentEdits: []
          }))
          return
        }
        set({
          fileLoading: false,
          fileError: isWriteImageFilePath(path)
            ? formatWriteImageLoadError(error)
            : error instanceof Error ? error.message : String(error)
        })
      }
    },

    createFile: async (workspaceRoot, path, content = '') => {
      let result: Awaited<ReturnType<typeof window.kunGui.createWorkspaceFile>>
      try {
        result = await window.kunGui.createWorkspaceFile({ workspaceRoot, path, content })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      await get().refreshWorkspace(workspaceRoot)
      await get().openFile(workspaceRoot, result.path)
      return result.path
    },

    createDirectory: async (workspaceRoot, path) => {
      let result: Awaited<ReturnType<typeof window.kunGui.createWorkspaceDirectory>>
      try {
        result = await window.kunGui.createWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        expandedDirs.add(writeDirnameFromPath(result.path))
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    renameEntry: async (workspaceRoot, path, newName) => {
      cancelExternalSyncAnimation()
      const nextName = ensureMarkdownRenameExtension(path, newName.trim())
      let result: Awaited<ReturnType<typeof window.kunGui.renameWorkspaceEntry>>
      try {
        result = await window.kunGui.renameWorkspaceEntry({ workspaceRoot, path, newName: nextName })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      saveWriteThreadRegistry(moveWriteFileThreads(
        workspaceRoot,
        result.previousPath,
        result.path
      ))
      const previousPrefix = `${normalizePath(result.previousPath)}/`
      set((state) => {
        const nextActiveFilePath = state.activeFilePath === result.previousPath
          ? result.path
          : state.activeFilePath?.startsWith(previousPrefix)
            ? `${result.path}/${state.activeFilePath.slice(previousPrefix.length)}`
            : state.activeFilePath
        const keepActiveFile = nextActiveFilePath ? isWriteWorkspaceFilePath(nextActiveFilePath) : false
        const nextActiveFileKind = keepActiveFile && nextActiveFilePath
          ? isWriteImageFilePath(nextActiveFilePath) ? 'image' : isWritePdfFilePath(nextActiveFilePath) ? 'pdf' : 'text'
          : null
        const activeDocumentChanged = nextActiveFilePath !== state.activeFilePath
        const nextDocumentEpoch = activeDocumentChanged
          ? nextWriteDocumentEpoch(state.documentEpoch)
          : state.documentEpoch
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          if (dirPath === result.previousPath) {
            expandedDirs.add(result.path)
          } else if (dirPath.startsWith(previousPrefix)) {
            expandedDirs.add(`${result.path}/${dirPath.slice(previousPrefix.length)}`)
          } else {
            expandedDirs.add(dirPath)
          }
        }
        return {
          activeFilePath: keepActiveFile ? nextActiveFilePath ?? null : null,
          activeFileKind: nextActiveFileKind,
          fileContent: nextActiveFileKind === 'text' ? state.fileContent : '',
          imageDataUrl: nextActiveFileKind === 'image' ? state.imageDataUrl : '',
          imageMimeType: nextActiveFileKind === 'image' ? state.imageMimeType : '',
          pdfDataBase64: nextActiveFileKind === 'pdf' ? state.pdfDataBase64 : '',
          pdfMimeType: nextActiveFileKind === 'pdf' ? state.pdfMimeType : '',
          pdfMtimeMs: nextActiveFileKind === 'pdf' ? state.pdfMtimeMs : 0,
          fileSize: keepActiveFile ? state.fileSize : 0,
          fileTruncated: keepActiveFile ? state.fileTruncated : false,
          saveStatus: keepActiveFile ? state.saveStatus : 'saved',
          documentEpoch: nextDocumentEpoch,
          contentRevision: keepActiveFile ? state.contentRevision : 0,
          persistedContent: nextActiveFileKind === 'text' ? state.persistedContent : '',
          pendingAgentReview: state.pendingAgentReview && keepActiveFile && nextActiveFilePath
            ? {
                ...state.pendingAgentReview,
                filePath: nextActiveFilePath,
                documentEpoch: nextDocumentEpoch
              }
            : null,
          reviewActive: keepActiveFile ? state.reviewActive : false,
          selection: nextActiveFileKind === 'text' || nextActiveFileKind === 'pdf' ? state.selection : emptySelection(),
          quotedSelections: nextActiveFileKind === 'text' || nextActiveFileKind === 'pdf' ? state.quotedSelections : [],
          expandedDirs,
          entriesByDir: {},
          fileError: null
        }
      })
      if (get().activeFilePath) {
        rememberActiveFile(workspaceRoot, get().activeFilePath)
      } else {
        rememberActiveFile(workspaceRoot, null)
      }
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    deleteEntry: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.kunGui.deleteWorkspaceEntry>>
      try {
        result = await window.kunGui.deleteWorkspaceEntry({ workspaceRoot, path })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatActionError(error) })
        return false
      }
      if (!workspaceIsCurrent(workspaceRoot)) return false
      if (!result.ok) {
        set({ fileError: result.message })
        return false
      }
      saveWriteThreadRegistry(forgetWriteFileThreads(workspaceRoot, result.path))
      const deletedPath = normalizePath(result.path)
      const currentActiveFilePath = get().activeFilePath
      const activePath = currentActiveFilePath ? normalizePath(currentActiveFilePath) : ''
      if (activePath === deletedPath || activePath.startsWith(`${deletedPath}/`)) {
        rememberActiveFile(workspaceRoot, null)
        set((state) => ({
          activeFilePath: null,
          activeFileKind: null,
          fileContent: '',
          imageDataUrl: '',
          imageMimeType: '',
          pdfDataBase64: '',
          pdfMimeType: '',
          pdfMtimeMs: 0,
          fileSize: 0,
          fileTruncated: false,
          fileError: null,
          saveStatus: 'saved',
          documentEpoch: nextWriteDocumentEpoch(state.documentEpoch),
          contentRevision: 0,
          persistedContent: '',
          pendingAgentReview: null,
          reviewActive: false,
          selection: emptySelection(),
          quotedSelections: [],
          recentEdits: []
        }))
      }
      set((state) => {
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          const normalizedDir = normalizePath(dirPath)
          if (normalizedDir !== deletedPath && !normalizedDir.startsWith(`${deletedPath}/`)) {
            expandedDirs.add(dirPath)
          }
        }
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return true
    }
  }
}
