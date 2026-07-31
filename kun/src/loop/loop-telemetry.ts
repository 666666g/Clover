import type { GuiDesignArtifactContext } from '../ports/tool-host.js'
import type { SessionStore } from '../ports/session-store.js'

const MAX_TOOL_CATALOG_SNAPSHOTS = 256
const MAX_HYDRATED_PRESSURE_THREADS = 512

type ToolCatalogSnapshot = {
  fingerprint: string
  toolNames: string[]
  toolHashes: Record<string, string>
}

export type ToolCatalogDrift =
  | { kind: 'none' }
  | { kind: 'additive'; previous: ToolCatalogSnapshot }
  | { kind: 'breaking'; previous: ToolCatalogSnapshot }

export type ToolCatalogFingerprintInput = {
  threadId: string
  workspace: string
  mode: string
  model: string
  activeSkillIds: readonly string[]
  allowedToolNames?: readonly string[]
  userInputDisabled?: boolean
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: GuiDesignArtifactContext
  fingerprint: string
  toolNames: string[]
  toolHashes: Record<string, string>
}

/**
 * Bounded, process-local telemetry state used to make cache and compaction
 * decisions. It deliberately owns no event or turn persistence: callers keep
 * those visible side effects in the orchestration layer.
 */
export class LoopTelemetry {
  private readonly promptTokenPressure = new Map<string, { model: string; promptTokens: number }>()
  /** Threads for which a one-time pressure hydration from persisted usage was already attempted. */
  private readonly hydratedPressureThreads = new Set<string>()
  private readonly toolCatalogSnapshots = new Map<string, ToolCatalogSnapshot>()

  constructor(private readonly sessionStore: SessionStore) {}

  recordPromptPressure(threadId: string, model: string, promptTokens: number): void {
    if (!threadId || promptTokens <= 0) return
    const current = this.promptTokenPressure.get(threadId)
    if (current && current.promptTokens >= promptTokens) return
    this.promptTokenPressure.set(threadId, { model, promptTokens })
  }

  /**
   * Seed prompt pressure from persisted request usage once per thread and
   * process. This keeps a restart from underestimating a history that already
   * includes a large system prompt or tool catalog. Failure is intentionally
   * best-effort; the caller's local estimator remains the fallback.
   */
  async hydratePromptPressureIfCold(threadId: string, fallbackModel: string): Promise<void> {
    if (!threadId) return
    if (this.promptTokenPressure.has(threadId)) return
    if (this.hydratedPressureThreads.has(threadId)) return
    const loadUsageRecords = this.sessionStore.loadUsageRecords
    if (typeof loadUsageRecords !== 'function') {
      this.rememberHydratedPressureThread(threadId)
      return
    }
    try {
      const records = await loadUsageRecords.call(this.sessionStore, { threadId })
      let restored: { model: string; promptTokens: number } | undefined
      for (const record of records) {
        if (record.threadId !== threadId) continue
        const promptTokens = Math.floor(record.usage?.promptTokens ?? 0)
        if (promptTokens > 0) {
          restored = { model: record.model || fallbackModel, promptTokens }
        }
      }
      if (restored && !this.promptTokenPressure.has(threadId)) {
        this.promptTokenPressure.set(threadId, restored)
      }
      this.rememberHydratedPressureThread(threadId)
    } catch {
      // Best-effort restore; the estimator + overhead floor still applies.
    }
  }

  consumePromptPressure(
    threadId: string,
    model: string
  ): { model: string; promptTokens: number } | undefined {
    if (!threadId) return undefined
    const pressure = this.promptTokenPressure.get(threadId)
    if (!pressure) return undefined
    this.promptTokenPressure.delete(threadId)
    return {
      model: pressure.model || model,
      promptTokens: pressure.promptTokens
    }
  }

  clearPromptPressure(threadId: string): void {
    this.promptTokenPressure.delete(threadId)
  }

  recordToolCatalogFingerprint(input: ToolCatalogFingerprintInput): ToolCatalogDrift {
    const key = JSON.stringify({
      threadId: input.threadId,
      workspace: input.workspace,
      mode: input.mode,
      model: input.model,
      activeSkillIds: [...input.activeSkillIds].sort(),
      allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames].sort() : [],
      userInputDisabled: input.userInputDisabled === true,
      guiDesignCanvas: input.guiDesignCanvas === true,
      guiDesignMode: input.guiDesignMode === true,
      guiDesignArtifact: input.guiDesignArtifact?.kind ?? null
    })
    const current: ToolCatalogSnapshot = {
      fingerprint: input.fingerprint,
      toolNames: input.toolNames,
      toolHashes: input.toolHashes
    }
    const previous = this.toolCatalogSnapshots.get(key)
    this.toolCatalogSnapshots.delete(key)
    this.toolCatalogSnapshots.set(key, current)
    if (this.toolCatalogSnapshots.size > MAX_TOOL_CATALOG_SNAPSHOTS) {
      const oldest = this.toolCatalogSnapshots.keys().next().value
      if (oldest !== undefined) this.toolCatalogSnapshots.delete(oldest)
    }
    if (!previous || previous.fingerprint === input.fingerprint) return { kind: 'none' }
    return isAdditiveToolCatalogChange(previous, current)
      ? { kind: 'additive', previous }
      : { kind: 'breaking', previous }
  }

  private rememberHydratedPressureThread(threadId: string): void {
    this.hydratedPressureThreads.delete(threadId)
    this.hydratedPressureThreads.add(threadId)
    if (this.hydratedPressureThreads.size > MAX_HYDRATED_PRESSURE_THREADS) {
      const oldest = this.hydratedPressureThreads.values().next().value
      if (oldest !== undefined) this.hydratedPressureThreads.delete(oldest)
    }
  }
}

function isAdditiveToolCatalogChange(previous: ToolCatalogSnapshot, current: ToolCatalogSnapshot): boolean {
  let added = false
  for (const name of current.toolNames) {
    if (!previous.toolHashes[name]) added = true
  }
  if (!added) return false
  for (const name of previous.toolNames) {
    const previousHash = previous.toolHashes[name]
    const currentHash = current.toolHashes[name]
    if (!previousHash || !currentHash || previousHash !== currentHash) return false
  }
  return true
}
