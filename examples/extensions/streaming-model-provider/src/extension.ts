import type {
  Account,
  AuthenticationApi,
  ExtensionContext,
  ModelProviderAdapter,
  ModelProviderDeclarationInput,
  ModelProviderOperationContext,
  ModelProviderRequest,
  ModelProviderStreamEvent,
  ProviderBinding,
  ProviderModel
} from '@kun/extension-api'

export const demoModels: ProviderModel[] = [
  {
    id: 'echo-1',
    displayName: 'Echo 1',
    description: 'A deterministic model for Extension Provider integration tests.',
    capabilities: {
      input: ['text'],
      output: ['text'],
      reasoning: false,
      tools: false,
      parallelTools: false,
      streaming: true,
      maxContextTokens: 8192,
      maxOutputTokens: 2048
    }
  }
]

export const providerDeclarations: ModelProviderDeclarationInput[] = [
  {
    id: 'echo-api-key',
    displayName: 'Echo Stream (API Key)',
    authenticationProviderId: 'api-key',
    adapterApiVersion: '1.0.0',
    models: demoModels
  },
  {
    id: 'echo-oauth',
    displayName: 'Echo Stream (OAuth PKCE)',
    authenticationProviderId: 'oauth',
    adapterApiVersion: '1.0.0',
    models: demoModels
  }
]

function messageText(request: ModelProviderRequest): string {
  const message = [...request.messages].reverse().find((candidate) => candidate.role === 'user')
  const text = message?.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim()
  return text || 'Hello from the Kun streaming Provider example.'
}

function chunks(value: string, size = 12): string[] {
  const result: string[] = []
  for (let offset = 0; offset < value.length; offset += size) {
    result.push(value.slice(offset, offset + size))
  }
  return result
}

export class DemoStreamingAdapter implements ModelProviderAdapter {
  readonly #cancelled = new Set<string>()

  constructor(private readonly accounts: Pick<AuthenticationApi, 'listAccounts'>) {}

  async #selectedAccount(binding: ProviderBinding): Promise<Account | undefined> {
    const accounts = await this.accounts.listAccounts({
      providerId: binding.providerId,
      includeUnavailable: true
    })
    return accounts.find((account) => account.id === binding.accountId)
  }

  async probe(
    binding: ProviderBinding,
    context: ModelProviderOperationContext
  ): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    if (context.cancellation.isCancellationRequested) {
      return { ok: false, latencyMs: 0, message: 'Probe cancelled' }
    }
    const account = await this.#selectedAccount(binding)
    return account?.status === 'connected'
      ? { ok: true, latencyMs: 0, message: `Account ${account.label} is connected` }
      : { ok: false, latencyMs: 0, message: 'Selected account is unavailable' }
  }

  async listModels(
    _binding: ProviderBinding,
    context: ModelProviderOperationContext
  ): Promise<ProviderModel[]> {
    return context.cancellation.isCancellationRequested ? [] : demoModels
  }

  async *stream(
    request: ModelProviderRequest,
    context: ModelProviderOperationContext
  ): AsyncIterable<ModelProviderStreamEvent> {
    let sequence = 0
    if (!demoModels.some((model) => model.id === request.binding.modelId)) {
      yield {
        requestId: request.requestId,
        sequence,
        type: 'error',
        code: 'MODEL_NOT_FOUND',
        message: `Unknown model ${request.binding.modelId}; the Provider will not fall back.`,
        retryable: false
      }
      return
    }

    const account = await this.#selectedAccount(request.binding)
    if (!account || account.status !== 'connected') {
      yield {
        requestId: request.requestId,
        sequence,
        type: 'error',
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'The explicitly selected account is unavailable; no other account was selected.',
        retryable: false
      }
      return
    }

    const response = `Echo via ${account.authenticationType}: ${messageText(request)}`
    try {
      for (const delta of chunks(response)) {
        if (context.cancellation.isCancellationRequested || this.#cancelled.has(request.requestId)) {
          yield {
            requestId: request.requestId,
            sequence: sequence++,
            type: 'error',
            code: 'REQUEST_CANCELLED',
            message: 'The model request was cancelled.',
            retryable: false
          }
          return
        }
        yield { requestId: request.requestId, sequence: sequence++, type: 'textDelta', delta }
        await Promise.resolve()
      }

      const usage = {
        inputTokens: Math.ceil(messageText(request).length / 4),
        outputTokens: Math.ceil(response.length / 4)
      }
      yield { requestId: request.requestId, sequence: sequence++, type: 'usage', usage }
      yield {
        requestId: request.requestId,
        sequence,
        type: 'completed',
        finishReason: 'stop',
        usage
      }
    } finally {
      this.#cancelled.delete(request.requestId)
    }
  }

  cancel(requestId: string): void {
    this.#cancelled.add(requestId)
  }

  async countTokens(request: ModelProviderRequest): Promise<number> {
    return Math.ceil(messageText(request).length / 4)
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  const adapter = new DemoStreamingAdapter(context.authentication)
  for (const declaration of providerDeclarations) {
    context.subscriptions.add(
      await context.modelProviders.registerProvider(declaration, adapter)
    )
  }
}

export async function deactivate(): Promise<void> {
  // Kun cancels provider requests before disposing both registrations.
}
