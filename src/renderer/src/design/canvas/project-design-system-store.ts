import { create } from 'zustand'
import type {
  ProjectDesignMdConflict,
  ProjectDesignMdDocument,
  ProjectDesignMdDraft,
  ProjectDesignMdSyncStatus,
  DesignMdDiagnostic
} from '../design-md/design-md-types'

type ProjectDesignSystemState = {
  workspaceRoot: string
  status: ProjectDesignMdSyncStatus
  document: ProjectDesignMdDocument | null
  draft: ProjectDesignMdDraft | null
  conflict: ProjectDesignMdConflict | null
  diagnostics: DesignMdDiagnostic[]
  errors: string[]
  sourceHash: string
  inspectorOpen: boolean
  setLoading: () => void
  setMissing: () => void
  setReady: (document: ProjectDesignMdDocument) => void
  setInvalid: (diagnostics: DesignMdDiagnostic[]) => void
  setDraft: (content: string) => void
  setSaving: () => void
  setConflict: (conflict: ProjectDesignMdConflict) => void
  acceptConflictCurrent: (document: ProjectDesignMdDocument) => void
  rebaseConflictDraft: () => void
  discardDraft: () => void
  setInspectorOpen: (open: boolean) => void
  activateWorkspace: (workspaceRoot: string) => void
}

export const useProjectDesignSystemStore = create<ProjectDesignSystemState>((set) => ({
  workspaceRoot: '',
  status: 'loading',
  document: null,
  draft: null,
  conflict: null,
  diagnostics: [],
  errors: [],
  sourceHash: '',
  inspectorOpen: false,
  setLoading: () => set({ status: 'loading', diagnostics: [], errors: [], conflict: null }),
  setMissing: () => set({ status: 'missing', document: null, draft: null, conflict: null, diagnostics: [], errors: [], sourceHash: '', inspectorOpen: false }),
  setReady: (document) => set({ status: 'ready', document, draft: null, conflict: null, diagnostics: [], errors: [], sourceHash: document.sourceHash }),
  setInvalid: (diagnostics) => set((state) => ({ ...state, status: 'invalid', diagnostics, errors: diagnostics.map((item) => item.message) })),
  setDraft: (content) => set((state) => ({
    status: 'dirty',
    draft: { content, baseHash: state.sourceHash, dirty: content !== state.document?.raw },
    conflict: null
  })),
  setSaving: () => set((state) => ({ ...state, status: 'saving' })),
  setConflict: (conflict) => set((state) => ({ ...state, status: 'conflict', conflict })),
  acceptConflictCurrent: (document) => set({
    status: 'ready',
    document,
    draft: null,
    conflict: null,
    diagnostics: [],
    errors: [],
    sourceHash: document.sourceHash
  }),
  rebaseConflictDraft: () => set((state) => state.conflict ? ({
    ...state,
    status: 'dirty',
    draft: {
      content: state.conflict.draftContent,
      baseHash: state.conflict.currentHash,
      dirty: true
    },
    conflict: null
  }) : state),
  discardDraft: () => set((state) => ({ ...state, status: state.document ? 'ready' : 'missing', draft: null, conflict: null })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  activateWorkspace: (workspaceRoot) => set((state) => state.workspaceRoot === workspaceRoot ? state : {
    workspaceRoot,
    status: 'loading',
    document: null,
    draft: null,
    conflict: null,
    diagnostics: [],
    errors: [],
    sourceHash: '',
    inspectorOpen: false
  })
}))
