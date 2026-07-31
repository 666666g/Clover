import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import type { ExtensionSettingsService } from './extension-settings-service'

const ExtensionSettingsServiceContext = createContext<ExtensionSettingsService | null>(null)

export function ExtensionSettingsServiceProvider({
  service,
  children
}: {
  service: ExtensionSettingsService | null
  children: ReactNode
}): ReactElement {
  return (
    <ExtensionSettingsServiceContext.Provider value={service}>
      {children}
    </ExtensionSettingsServiceContext.Provider>
  )
}

export function useExtensionSettingsService(): ExtensionSettingsService | null {
  return useContext(ExtensionSettingsServiceContext)
}
