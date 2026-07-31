import type {
  ExtensionContext,
  ModelProviderAdapter,
  ModelProviderDeclarationInput,
  ModelProviderRequest,
  ModelProviderStreamEvent,
  ProviderModel
} from '@kun/extension-api'

const models: ProviderModel[] = [
  {
    id: 'echo-1',
    displayName: 'Echo 1',
    capabilities: {
      input: ['text'],
      output: ['text'],
      reasoning: false,
      tools: false,
      parallelTools: false,
      streaming: true
    }
  }
]

const provider: ModelProviderDeclarationInput = {
  id: 'external-stream',
  displayName: 'External Stream',
  authenticationProviderId: 'release-key',
  adapterApiVersion: '1.0.0',
  models
}

const adapter: ModelProviderAdapter = {
  async probe() {
    return { ok: true, latencyMs: 0, message: 'external acceptance provider ready' }
  },
  async listModels() {
    return models
  },
  async *stream(request: ModelProviderRequest): AsyncIterable<ModelProviderStreamEvent> {
    yield {
      requestId: request.requestId,
      sequence: 0,
      type: 'textDelta',
      delta: 'streamed from an external packaged-SDK project'
    }
    yield {
      requestId: request.requestId,
      sequence: 1,
      type: 'completed',
      finishReason: 'stop',
      usage: { outputTokens: 7 }
    }
  },
  cancel() {}
}

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('run-agent', async (args) => {
      const input = typeof args === 'string' ? args : 'external acceptance run'
      const { run } = await context.agent.createRun({ input, visibility: 'private' })
      return { runId: run.id, threadId: run.threadId, state: run.state }
    })
  )
  context.subscriptions.add(
    await context.tools.registerTool(
      {
        id: 'release-echo',
        description: 'Echo a value through the public Kun tool contract.',
        inputSchema: { type: 'object' },
        sideEffects: 'none',
        idempotent: true
      },
      async (input) => ({ content: { echoed: input.value ?? null } })
    )
  )
  context.subscriptions.add(await context.modelProviders.registerProvider(provider, adapter))
}

export async function deactivate(): Promise<void> {}
