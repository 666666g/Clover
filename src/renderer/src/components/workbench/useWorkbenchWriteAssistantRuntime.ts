import { useEffect, useMemo, useRef } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  buildComposerAssistantPickList,
  resolveComposerAssistantProviderId
} from '../chat/composer-model-selection'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  activeWriteThreadForWorkspace,
  readWriteThreadRegistry
} from '../../write/write-thread-registry'

type WorkbenchWriteAssistantRuntimeOptions = {
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
}

export function useWorkbenchWriteAssistantRuntime({
  composerPickList,
  composerModelGroups
}: WorkbenchWriteAssistantRuntimeOptions) {
  const writeAssistantOpen = useWriteWorkspaceStore((s) => s.assistantOpen)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const writeAssistantProviderId = useWriteWorkspaceStore((s) => s.assistantProviderId)
  const writeWorkspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const activeWriteFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const route = useChatStore((s) => s.route)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const pendingThreadIdRef = useRef<string | null>(null)
  const writeAssistantPickList = useMemo(() => {
    return buildComposerAssistantPickList({
      composerPickList
    })
  }, [composerPickList])
  const resolvedWriteAssistantProviderId = useMemo(() => {
    return resolveComposerAssistantProviderId({
      composerModelGroups,
      model: writeAssistantModel,
      storedProviderId: writeAssistantProviderId
    })
  }, [composerModelGroups, writeAssistantModel, writeAssistantProviderId])

  useEffect(() => {
    if (route !== 'write' || !writeWorkspaceRoot) return
    const chatState = useChatStore.getState()
    if (!activeWriteFilePath) {
      if (activeThreadId) chatState.clearActiveThreadSelection()
      return
    }
    if (runtimeConnection !== 'ready') {
      if (activeThreadId) chatState.clearActiveThreadSelection()
      return
    }

    const target = activeWriteThreadForWorkspace(
      writeWorkspaceRoot,
      threads,
      readWriteThreadRegistry(),
      activeWriteFilePath
    )
    if (target?.id === activeThreadId) return
    if (target) {
      if (pendingThreadIdRef.current === target.id) return
      pendingThreadIdRef.current = target.id
      void chatState.selectWriteThread(target.id, writeWorkspaceRoot).finally(() => {
        if (pendingThreadIdRef.current === target.id) pendingThreadIdRef.current = null
      })
    } else if (activeThreadId) {
      chatState.clearActiveThreadSelection()
    }
  }, [activeThreadId, activeWriteFilePath, route, runtimeConnection, threads, writeWorkspaceRoot])

  return {
    resolvedWriteAssistantProviderId,
    setWriteAssistantModel,
    setWriteAssistantOpen,
    writeAssistantModel,
    writeAssistantOpen,
    writeAssistantPickList
  }
}
