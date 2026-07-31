import type { ModelClient } from '../ports/model-client.js'

export type ModelClientDiagnostics = {
  provider?: string
  providerBaseUrl?: string
  endpointFormat?: string
  configuredModel?: string
}

export function modelClientDiagnostics(
  model: ModelClient,
  providerId?: string
): ModelClientDiagnostics {
  const client = model as ModelClient & {
    config?: {
      baseUrl?: string
      endpointFormat?: string
      model?: string
    }
    configFor?: (providerId?: string) => {
      baseUrl?: string
      endpointFormat?: string
      model?: string
    } | undefined
  }
  let config: {
    baseUrl?: string
    endpointFormat?: string
    model?: string
  } | undefined
  if (client.configFor) {
    try {
      config = client.configFor(providerId)
    } catch {
      // Diagnostics must never replace the original routing error. In
      // particular, an unknown explicit provider is expected to throw from the
      // routing boundary, not while we are merely collecting log metadata.
      config = providerId?.trim() ? undefined : client.config
    }
  } else {
    config = client.config
  }
  return {
    provider: client.provider,
    ...(config?.baseUrl ? { providerBaseUrl: sanitizeProviderBaseUrl(config.baseUrl) } : {}),
    ...(config?.endpointFormat ? { endpointFormat: config.endpointFormat } : {}),
    ...(config?.model ? { configuredModel: config.model } : {})
  }
}

export function sanitizeProviderBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    // Invalid URLs do not have reliable credential/query boundaries. Avoid
    // echoing provider configuration into diagnostics when parsing fails.
    return '[invalid URL]'
  }
}
