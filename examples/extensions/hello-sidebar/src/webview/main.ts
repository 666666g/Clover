import { ExtensionHostClient, type HostTransport } from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

type HelloState = { greetings: number }

const client = new ExtensionHostClient(window.kunExtension)
const button = document.querySelector<HTMLButtonElement>('#greet')
const count = document.querySelector<HTMLOutputElement>('#count')
const localeLabel = document.querySelector<HTMLElement>('#locale')
let state: HelloState = (await client.ui.getViewState<HelloState>()) ?? { greetings: 0 }

function render(): void {
  if (count) count.textContent = `Greetings sent: ${state.greetings}`
}

async function applyTheme(): Promise<void> {
  const theme = await client.ui.getTheme()
  document.documentElement.dataset.theme = theme.kind
  for (const [name, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(`--kun-${name}`, value)
  }
}

button?.addEventListener('click', () => {
  state = { greetings: state.greetings + 1 }
  render()
  void client.ui.setViewState(state)
})

client.ui.onDidChangeTheme(() => void applyTheme())
const locale = await client.ui.getLocale()
if (localeLabel) localeLabel.textContent = `Kun Extension · ${locale.language}`
await applyTheme()
render()

window.addEventListener('pagehide', () => void client.dispose(), { once: true })
