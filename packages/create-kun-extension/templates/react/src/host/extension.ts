import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', async () => {
      await context.ui.postMessage({ channel: 'refresh', payload: { requested: true } })
      return { accepted: true }
    })
  )
}

export async function deactivate(): Promise<void> {
  // Resources registered in context.subscriptions are disposed by Kun.
}
