import type { JsonResponse } from './response.js'

export type RouteContext = { params: Record<string, string> }
export type RouteHandler = (
  request: Request,
  context: RouteContext
) => Promise<Response | JsonResponse> | Response | JsonResponse

/**
 * Minimal router that supports `:param` placeholders. Routes are
 * registered with `(method, path, handler)` tuples and resolved in
 * registration order. The first matching route wins; this keeps
 * extension paths (`/v1/threads/:id/turns/:turnId`) explicit.
 */
export class Router {
  private readonly routes: Array<{
    method: string
    pattern: string
    segments: string[]
    handler: RouteHandler
  }> = []

  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      pattern: path,
      segments: path.split('/').filter(Boolean),
      handler
    })
  }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | undefined {
    const upperMethod = method.toUpperCase()
    const segments = path.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== upperMethod) continue
      if (route.segments.length !== segments.length) continue
      const params: Record<string, string> = {}
      let matches = true
      for (let i = 0; i < route.segments.length; i += 1) {
        const want = route.segments[i]
        const got = segments[i]
        if (want.startsWith(':')) {
          const decoded = decodePathSegment(got)
          if (decoded === null) {
            matches = false
            break
          }
          params[want.slice(1)] = decoded
        } else if (want !== got) {
          matches = false
          break
        }
      }
      if (matches) return { handler: route.handler, params }
    }
    return undefined
  }
}

/**
 * A route parameter always represents one URL path segment. Encoded path
 * separators and NUL bytes must therefore be rejected rather than decoded
 * into a value that a downstream filesystem adapter could interpret as a
 * path. Invalid percent encodings are treated as an unmatched route.
 */
function decodePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    return /[\\/\0]/.test(decoded) ? null : decoded
  } catch {
    return null
  }
}
