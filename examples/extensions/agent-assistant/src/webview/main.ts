import {
  ExtensionHostClient,
  type AgentRunEvent,
  type AgentRunSubscription,
  type HostTransport
} from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.kunExtension)
const form = document.querySelector<HTMLFormElement>('#prompt-form')
const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')
const historyButton = document.querySelector<HTMLButtonElement>('#history')
const status = document.querySelector<HTMLElement>('#status')
const events = document.querySelector<HTMLOListElement>('#events')
let activeRunId: string | undefined
let subscription: AgentRunSubscription | undefined

function addEvent(label: string, detail?: string): void {
  const item = document.createElement('li')
  item.textContent = detail ? `${label}: ${detail}` : label
  events?.append(item)
}

function describeEvent(event: AgentRunEvent): string {
  if (event.type === 'state' || event.type === 'terminal') return event.state
  if (event.type === 'progress') return event.message
  if (event.type === 'usage') return JSON.stringify(event.usage)
  if (event.type === 'steering-accepted') return event.steeringId
  return JSON.stringify(event.content)
}

async function observe(runId: string): Promise<void> {
  await subscription?.dispose()
  subscription = await client.agent.subscribe({ runId, afterSequence: 0 })
  subscription.onEvent((event) => {
    addEvent(`${event.sequence} · ${event.type}`, describeEvent(event))
    if (event.type === 'terminal') {
      activeRunId = undefined
      if (cancelButton) cancelButton.disabled = true
      if (status) status.textContent = `Run ${event.state}`
    }
  })
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  const input = prompt?.value.trim()
  if (!input) return
  events?.replaceChildren()
  if (status) status.textContent = 'Creating an extension-owned run…'
  void client.agent
    .createRun({
      input,
      profileId: 'assistant',
      visibility: 'private',
      budget: { maxTokens: 2048, maxElapsedMs: 60000, maxModelRequests: 6, maxToolInvocations: 8 }
    })
    .then(async ({ run }) => {
      activeRunId = run.id
      if (cancelButton) cancelButton.disabled = false
      if (status) status.textContent = `Run ${run.id} · ${run.state}`
      await client.ui.setViewState({ lastRunId: run.id })
      await observe(run.id)
    })
    .catch((error) => {
      if (status) status.textContent = error instanceof Error ? error.message : String(error)
    })
})

cancelButton?.addEventListener('click', () => {
  if (!activeRunId) return
  void client.agent.cancel({ runId: activeRunId, reason: 'Cancelled from Agent Assistant View' })
})

historyButton?.addEventListener('click', () => {
  void client.threads
    .listOwn({ limit: 10 })
    .then(({ items }) => {
      addEvent('Owned threads', items.map((item) => item.title ?? item.id).join(', ') || 'none')
    })
    .catch((error) => {
      if (status) status.textContent = error instanceof Error ? error.message : String(error)
    })
})

const restored = await client.ui.getViewState<{ lastRunId: string }>()
if (restored?.lastRunId) {
  activeRunId = restored.lastRunId
  if (status) status.textContent = `Restoring ${restored.lastRunId}`
  try {
    const run = await client.agent.getRun(restored.lastRunId)
    if (!['completed', 'failed', 'cancelled', 'budget-exhausted'].includes(run.state)) {
      if (cancelButton) cancelButton.disabled = false
      await observe(run.id)
    } else if (status) {
      status.textContent = `Last run ${run.state}`
    }
  } catch {
    if (status) status.textContent = 'Last run is no longer available'
  }
}

window.addEventListener(
  'pagehide',
  () =>
    void (async () => {
      await subscription?.dispose()
      await client.dispose()
    })(),
  { once: true }
)
