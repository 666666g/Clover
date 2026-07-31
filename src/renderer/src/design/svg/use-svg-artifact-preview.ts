import { useEffect, useMemo, useState } from 'react'
import { buildSvgPreviewDocument, parseAndSanitizeSvgDocument, type SvgDiagnostic } from './svg-document'

export type SvgArtifactPreviewState = {
  status: 'loading' | 'ready' | 'invalid' | 'missing'
  srcDoc: string
  diagnostics: SvgDiagnostic[]
  animationCount: number
  visualElementCount: number
  durationMs: number
  loopsIndefinitely: boolean
  revision: number
}

type StoredSvgArtifactPreviewState = Omit<SvgArtifactPreviewState, 'srcDoc'> & { svg: string }

const INITIAL: StoredSvgArtifactPreviewState = {
  status: 'loading',
  svg: '',
  diagnostics: [],
  animationCount: 0,
  visualElementCount: 0,
  durationMs: 4000,
  loopsIndefinitely: false,
  revision: 0
}

export function useSvgArtifactPreview(
  workspaceRoot: string,
  relativePath: string,
  background: 'transparent' | 'light' | 'dark'
): SvgArtifactPreviewState {
  const [state, setState] = useState<StoredSvgArtifactPreviewState>(INITIAL)

  useEffect(() => {
    let cancelled = false
    let watchId = ''
    let offChanged: (() => void) | undefined
    const api = typeof window !== 'undefined' ? window.kunGui : undefined
    setState(INITIAL)
    if (!workspaceRoot || !relativePath || typeof api?.readWorkspaceFile !== 'function') return

    const apply = (content: string, truncated = false): void => {
      if (cancelled) return
      if (truncated) {
        setState((current) => ({
          ...current,
          status: 'invalid',
          diagnostics: [{
            severity: 'error',
            code: 'source-truncated',
            message: 'SVG source was truncated while reading and cannot be previewed safely.'
          }],
          revision: current.revision + 1
        }))
        return
      }
      const parsed = parseAndSanitizeSvgDocument(content)
      if (!parsed.ok) {
        setState((current) => ({
          ...current,
          status: 'invalid',
          diagnostics: parsed.diagnostics,
          revision: current.revision + 1
        }))
        return
      }
      setState((current) => ({
        status: 'ready',
        svg: parsed.svg,
        diagnostics: parsed.diagnostics,
        animationCount: parsed.animationCount,
        visualElementCount: parsed.visualElementCount,
        durationMs: parsed.durationMs,
        loopsIndefinitely: parsed.loopsIndefinitely,
        revision: current.revision + 1
      }))
    }

    const load = async (): Promise<void> => {
      const result = await api.readWorkspaceFile({ path: relativePath, workspaceRoot }).catch(() => null)
      if (cancelled) return
      if (!result?.ok) {
        setState((current) => ({ ...current, status: 'missing', revision: current.revision + 1 }))
        return
      }
      apply(result.content, result.truncated)
    }

    if (api.watchWorkspaceFile && api.unwatchWorkspaceFile && api.onWorkspaceFileChanged) {
      offChanged = api.onWorkspaceFileChanged((payload) => {
        if (!cancelled && watchId && payload.watchId === watchId) {
          if (payload.ok) apply(payload.content, payload.truncated)
          else void load()
        }
      })
      void api.watchWorkspaceFile({ path: relativePath, workspaceRoot }).then((result) => {
        if (cancelled) {
          if (result.ok) void api.unwatchWorkspaceFile?.(result.watchId)
          return
        }
        if (result.ok) {
          watchId = result.watchId
          apply(result.content, result.truncated)
        } else {
          void load()
        }
      }).catch(() => {
        void load()
      })
    } else {
      void load()
    }

    return () => {
      cancelled = true
      offChanged?.()
      if (watchId) void api.unwatchWorkspaceFile?.(watchId).catch(() => undefined)
    }
  }, [relativePath, workspaceRoot])

  return useMemo(() => {
    const { svg, ...preview } = state
    return {
      ...preview,
      srcDoc: preview.status === 'ready' ? buildSvgPreviewDocument(svg, background) : ''
    }
  }, [background, state])
}
