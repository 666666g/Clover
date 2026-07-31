import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  // The profile is static Manifest metadata. Runs are created through the same
  // public Agent API from the sandboxed View and remain owned by this extension.
  void context
}

export async function deactivate(): Promise<void> {
  // Active subscriptions are disposed by their owning View session and by Kun.
}
