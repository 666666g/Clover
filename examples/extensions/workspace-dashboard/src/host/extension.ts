import type { ExtensionContext, JsonObject } from '@kun/extension-api'

function displayName(entry: JsonObject): string {
  const candidate = entry.name ?? entry.path ?? entry.uri
  return typeof candidate === 'string' ? candidate : '(unnamed entry)'
}

export async function activate(context: ExtensionContext): Promise<void> {
  const refresh = async (): Promise<JsonObject> => {
    const entries = await context.workspace.list('.')
    const summary: JsonObject = {
      workspace: context.workspaceContext?.name ?? 'No active workspace',
      root: context.workspaceContext?.root ?? '',
      trusted: context.workspaceContext?.trusted ?? false,
      entryCount: entries.length,
      entries: entries.slice(0, 20).map(displayName),
      refreshedAt: new Date().toISOString()
    }
    await context.storage.workspace.set('last-summary', summary)
    await context.ui.postMessage({ channel: 'workspace-dashboard', payload: summary })
    return summary
  }

  context.subscriptions.add(
    await context.commands.registerCommand('refresh-dashboard', refresh)
  )
}

export async function deactivate(): Promise<void> {
  // Kun disposes context.subscriptions before the Extension Host exits.
}
