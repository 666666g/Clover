import { ExtensionHostClient, type HostTransport } from '@kun/extension-api'
import { increment, type ViewState } from './state.js'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.kunExtension)
const button = document.querySelector<HTMLButtonElement>('#increment')
let state: ViewState = (await client.ui.getViewState<ViewState>()) ?? { count: 0 }

function render(): void {
  if (button) button.textContent = `Count: ${state.count}`
}

button?.addEventListener('click', () => {
  state = increment(state)
  render()
  void client.ui.setViewState(state)
})

const theme = await client.ui.getTheme()
document.documentElement.dataset.theme = theme.kind
client.ui.onDidChangeTheme((next) => {
  document.documentElement.dataset.theme = next.kind
})
render()
