import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeImagePreviewUrl,
  runtimeImageSourceForFile,
  uploadRuntimeImageAttachment
} from './runtime-image-attachment'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime image attachment renderer bridge', () => {
  it('prefers a local path without reading the File bytes', async () => {
    const file = new File(['image'], 'shot.png', { type: 'image/png' })
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer')
    await expect(runtimeImageSourceForFile(file, '/tmp/shot.png')).resolves.toEqual({
      kind: 'localPath',
      path: '/tmp/shot.png'
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('uses bounded Base64 fallback sources when no local path exists', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'inline.png', { type: 'image/png' })
    await expect(runtimeImageSourceForFile(file)).resolves.toEqual({
      kind: 'base64',
      dataBase64: 'AQID',
      mimeType: 'image/png'
    })
  })

  it('returns the dedicated IPC result and builds its bounded preview URL', async () => {
    const success = {
      ok: true as const,
      attachment: {
        id: 'att_1', name: 'shot.webp', mimeType: 'image/webp', byteSize: 3,
        hash: 'hash', createdAt: 't0', updatedAt: 't0'
      },
      preview: {
        dataBase64: 'AQID', mimeType: 'image/webp', byteSize: 3, width: 1, height: 1
      },
      compression: { sourceBytes: 20, outputBytes: 3, fallbackBytes: 3, wasCompressed: true }
    }
    const upload = vi.fn(async () => success)
    vi.stubGlobal('window', { kunGui: { uploadRuntimeImageAttachment: upload } })

    const result = await uploadRuntimeImageAttachment({
      source: { kind: 'clipboard' },
      threadId: 'thr_1'
    })
    expect(upload).toHaveBeenCalledWith({ source: { kind: 'clipboard' }, threadId: 'thr_1' })
    expect(runtimeImagePreviewUrl(result)).toBe('data:image/webp;base64,AQID')
  })
})
