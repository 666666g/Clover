export type ExtensionErrorDetails = Record<string, unknown>

export class ExtensionError extends Error {
  readonly code: string
  readonly details: ExtensionErrorDetails

  constructor(code: string, message: string, details: ExtensionErrorDetails = {}, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ExtensionError'
    this.code = code
    this.details = details
  }
}

export function extensionError(
  code: string,
  message: string,
  details: ExtensionErrorDetails = {},
  cause?: unknown
): ExtensionError {
  return new ExtensionError(code, message, details, cause === undefined ? undefined : { cause })
}

export function asExtensionError(
  error: unknown,
  fallbackCode = 'EXTENSION_INTERNAL_ERROR',
  fallbackMessage = 'Extension operation failed'
): ExtensionError {
  if (error instanceof ExtensionError) return error
  return extensionError(fallbackCode, fallbackMessage, {}, error)
}
