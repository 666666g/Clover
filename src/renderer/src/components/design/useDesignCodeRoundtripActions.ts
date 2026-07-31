import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import {
  canPrepareImplementDesignTurn,
  dispatchImplementDesignTurn,
  type DesignCodeRoundtripCreateThread,
  type DesignCodeRoundtripSendMessage
} from '../../design/design-code-roundtrip'
import type { DesignArtifact } from '../../design/design-types'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'

export type DesignCodeRoundtripActionsOptions = {
  workspaceRoot: string
  createThread: DesignCodeRoundtripCreateThread
  sendMessage: DesignCodeRoundtripSendMessage
  setError: (error: string | null) => void
  setConnectPhoneSidebarOpen: (open: boolean) => void
  openDesign: () => void
}

export type DesignCodeRoundtripActions = {
  openDesignMode: () => void
  implementDesignInCode: (artifact: DesignArtifact) => void
}

export function useDesignCodeRoundtripActions({
  workspaceRoot,
  createThread,
  sendMessage,
  setError,
  setConnectPhoneSidebarOpen,
  openDesign
}: DesignCodeRoundtripActionsOptions): DesignCodeRoundtripActions {
  const { t } = useTranslation()
  const setDesignAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)

  const openDesignMode = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    setDesignAssistantOpen(true)
    openDesign()
  }, [openDesign, setConnectPhoneSidebarOpen, setDesignAssistantOpen])

  const implementDesignInCode = useCallback((artifact: DesignArtifact): void => {
    if (!canPrepareImplementDesignTurn(artifact)) {
      setError(t('designImplementHtmlOnly'))
      return
    }
    const designState = useDesignWorkspaceStore.getState()
    const designWorkspaceRoot = designState.workspaceRoot || workspaceRoot
    if (!designWorkspaceRoot) {
      setError(t('workspaceRequiredToCreateThread'))
      return
    }
    void dispatchImplementDesignTurn({
      artifact,
      designState,
      workspaceRoot: designWorkspaceRoot,
      createThread,
      sendMessage,
      displayText: t('designImplementDisplay', { title: artifact.title }),
      getActiveThreadId: () => useChatStore.getState().activeThreadId
    })
  }, [createThread, sendMessage, setError, t, workspaceRoot])

  return {
    openDesignMode,
    implementDesignInCode
  }
}
