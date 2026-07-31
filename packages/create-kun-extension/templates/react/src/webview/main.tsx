import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionHostClient, type HostTransport } from '@kun/extension-api'
import {
  ExtensionAsyncBoundary,
  ExtensionViewProvider,
  useHostMessage,
  useTheme,
  useViewState
} from '@kun/extension-react'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

type ViewState = { count: number }

function App() {
  const theme = useTheme()
  const { state, setState, saving } = useViewState<ViewState>({ count: 0 })
  const refresh = useHostMessage('refresh')
  return (
    <ExtensionAsyncBoundary value={theme}>
      {(resolvedTheme) => (
        <main data-theme={resolvedTheme.kind}>
          <h1>{"{{DISPLAY_NAME_JSON}}"}</h1>
          <p>{refresh ? 'Refresh requested by host' : 'Ready'}</p>
          <button type="button" disabled={saving} onClick={() => setState((value) => ({ count: value.count + 1 }))}>
            Count: {state.count}
          </button>
        </main>
      )}
    </ExtensionAsyncBoundary>
  )
}

const client = new ExtensionHostClient(window.kunExtension)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExtensionViewProvider client={client}>
      <App />
    </ExtensionViewProvider>
  </StrictMode>
)
