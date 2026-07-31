import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('hello', async () => ({
      message: "{{HELLO_TITLE_JSON}}"
    }))
  )
}

export async function deactivate(): Promise<void> {
  // Resources registered in context.subscriptions are disposed by Kun.
}
