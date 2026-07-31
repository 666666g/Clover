import type {
  ExtensionContext,
  ExtensionToolDeclarationInput,
  JsonObject,
  ToolInvocationContext,
  ToolResult
} from '@kun/extension-api'

export const workspaceSummaryTool = {
  id: 'workspace-summary',
  description: 'List a bounded set of entries under a workspace-relative path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative directory, defaults to the root.'
      }
    },
    additionalProperties: false
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      entryCount: { type: 'number' },
      entries: { type: 'array', items: { type: 'string' } }
    },
    required: ['path', 'entryCount', 'entries'],
    additionalProperties: false
  },
  sideEffects: 'read',
  idempotent: true,
  maxOutputBytes: 65_536
} satisfies ExtensionToolDeclarationInput

function entryName(entry: JsonObject): string {
  const value = entry.name ?? entry.path ?? entry.uri
  return typeof value === 'string' ? value : '(unnamed entry)'
}

export function summarizeEntries(path: string, entries: JsonObject[]): JsonObject {
  return {
    path,
    entryCount: entries.length,
    entries: entries.slice(0, 100).map(entryName)
  }
}

async function runWorkspaceSummary(
  context: ExtensionContext,
  input: JsonObject,
  invocation: ToolInvocationContext
): Promise<ToolResult> {
  const path = typeof input.path === 'string' && input.path.length > 0 ? input.path : '.'
  if (invocation.cancellation.isCancellationRequested) {
    throw new Error('Tool invocation was cancelled before workspace access')
  }
  await invocation.reportProgress({ message: `Reading ${path}`, fraction: 0.25 })
  const entries = await context.workspace.list(path)
  if (invocation.cancellation.isCancellationRequested) {
    throw new Error('Tool invocation was cancelled after workspace access')
  }
  const content = summarizeEntries(path, entries)
  await invocation.reportProgress({ message: `Summarized ${entries.length} entries`, fraction: 1 })
  return {
    content,
    summary: `${entries.length} workspace entries under ${path}`,
    metadata: { truncated: entries.length > 100 }
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.tools.registerTool(workspaceSummaryTool, (input, invocation) =>
      runWorkspaceSummary(context, input, invocation)
    )
  )
}

export async function deactivate(): Promise<void> {
  // Kun cancels in-flight invocations and disposes the registration.
}
