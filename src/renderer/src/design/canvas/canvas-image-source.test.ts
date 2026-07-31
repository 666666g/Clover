import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasImageDataUrlCache,
  clearWorkspaceImageDataUrlCache,
  isAbsoluteLocalImagePath,
  loadWorkspaceImageDataUrl,
  workspaceImageDataUrlCacheStats
} from './canvas-image-source'

afterEach(() => {
  clearWorkspaceImageDataUrlCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas image source loading', () => {
  it('evicts least-recently-used entries by byte and entry limits', () => {
    const cache = new CanvasImageDataUrlCache(6, 2)
    cache.set('a', '/a', 'data:image/png;base64,YWFh')
    cache.set('b', '/a', 'data:image/png;base64,YmJi')
    expect(cache.get('a')).toBe('data:image/png;base64,YWFh')

    cache.set('c', '/b', 'data:image/png;base64,Y2Nj')

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).not.toBeNull()
    expect(cache.get('c')).not.toBeNull()
    expect(cache.stats()).toEqual({ entries: 2, bytes: 6 })
  })

  it('clears cached image data for one workspace without touching another', () => {
    const cache = new CanvasImageDataUrlCache(64, 8)
    cache.set('a', '/workspace/a', 'data:image/png;base64,YQ==')
    cache.set('b', '/workspace/b', 'data:image/png;base64,Yg==')

    cache.clear('/workspace/a')

    expect(cache.stats('/workspace/a')).toEqual({ entries: 0, bytes: 0 })
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('data:image/png;base64,Yg==')
  })

  it('does not permanently cache a failed workspace image read', async () => {
    const dataUrl = 'data:image/png;base64,ok'
    const readWorkspaceImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'File not found' })
      .mockResolvedValueOnce({ ok: true, dataUrl, path: '/ws/img/flaky.png', mimeType: 'image/png', size: 2 })
    vi.stubGlobal('window', { kunGui: { readWorkspaceImage } })

    await expect(loadWorkspaceImageDataUrl('/ws', 'img/flaky-retry.png')).resolves.toBeNull()
    await expect(loadWorkspaceImageDataUrl('/ws', 'img/flaky-retry.png')).resolves.toBe(dataUrl)
    expect(readWorkspaceImage).toHaveBeenCalledTimes(2)
  })

  it('reads absolute local image paths without applying the canvas workspace boundary', async () => {
    const absolutePath = '/Users/zxy/.kun/default_workspace/.deepseekgui-images/generated.png'
    const readWorkspaceImage = vi.fn(async () => ({
      ok: true,
      dataUrl: 'data:image/png;base64,ok',
      path: absolutePath,
      mimeType: 'image/png',
      size: 2
    }))
    vi.stubGlobal('window', { kunGui: { readWorkspaceImage } })

    await expect(loadWorkspaceImageDataUrl('/Users/zxy/.kun/design-workspace', absolutePath))
      .resolves.toBe('data:image/png;base64,ok')
    expect(isAbsoluteLocalImagePath(absolutePath)).toBe(true)
    expect(readWorkspaceImage).toHaveBeenCalledWith({ path: absolutePath })
    expect(workspaceImageDataUrlCacheStats('/Users/zxy/.kun/design-workspace').entries).toBe(1)
  })
})
