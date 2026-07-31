import { ExtensionHostClient, type HostTransport, type JsonObject } from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.kunExtension)
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')
const status = document.querySelector<HTMLElement>('#status')
const entryList = document.querySelector<HTMLOListElement>('#entries')

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback
}

async function render(summary: JsonObject): Promise<void> {
  const entries = Array.isArray(summary.entries)
    ? summary.entries.filter((entry): entry is string => typeof entry === 'string')
    : []
  const bindings: Record<string, unknown> = {
    'workspace-name': summary.workspace,
    root: summary.root,
    trusted: summary.trusted,
    'entry-count': summary.entryCount
  }
  for (const [id, value] of Object.entries(bindings)) {
    const element = document.getElementById(id)
    if (element) element.textContent = text(value)
  }
  entryList?.replaceChildren(
    ...entries.map((name) => {
      const item = document.createElement('li')
      item.textContent = name
      return item
    })
  )
  if (status) status.textContent = `Updated ${text(summary.refreshedAt)}`
  await client.ui.setViewState(summary)
}

async function refresh(): Promise<void> {
  if (refreshButton) refreshButton.disabled = true
  if (status) status.textContent = 'Reading workspace…'
  try {
    const summary = await client.commands.executeCommand<JsonObject>('refresh-dashboard')
    await render(summary)
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    if (refreshButton) refreshButton.disabled = false
  }
}

client.ui.onDidReceiveMessage((message) => {
  if (message.channel === 'workspace-dashboard' && !Array.isArray(message.payload) && message.payload !== null) {
    void render(message.payload as JsonObject)
  }
})
refreshButton?.addEventListener('click', () => void refresh())

const restored = await client.ui.getViewState<JsonObject>()
if (restored) await render(restored)
else await refresh()

window.addEventListener('pagehide', () => void client.dispose(), { once: true })
