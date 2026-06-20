import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => 'test')
  }
}))

import { app } from 'electron'
import { LOCAL_WHISPER_MODELS, LOCAL_WHISPER_SMALL_MODEL_ID, localWhisperModelById } from '../../shared/local-whisper'
import { _internals } from './local-whisper-service'

describe('local-whisper-service helpers', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-local-whisper-'))
    vi.mocked(app.getPath).mockReturnValue(rootDir)
  })

  it('keeps checksum metadata for every downloadable model', () => {
    for (const model of LOCAL_WHISPER_MODELS) {
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(model.downloadUrl).toContain('https://huggingface.co/')
      expect(model.downloadMirrors.some((mirror) => mirror.downloadUrl.includes('https://hf-mirror.com/'))).toBe(true)
      expect(model.downloadMirrors.some((mirror) => mirror.downloadUrl.includes('https://hf-cdn.sufy.com/'))).toBe(true)
    }
  })

  it('resolves the selected model download source', () => {
    const model = localWhisperModelById(LOCAL_WHISPER_SMALL_MODEL_ID)

    expect(_internals.localWhisperDownloadUrl(model, 'huggingface')).toBe(model.downloadUrl)
    expect(_internals.localWhisperDownloadUrl(model, 'hf-mirror')).toContain('https://hf-mirror.com/')
    expect(_internals.localWhisperDownloadUrl(model, 'hf-sufy')).toContain('https://hf-cdn.sufy.com/')
  })

  it('computes sha256 checksums for downloaded files', async () => {
    const path = join(rootDir, 'sample.bin')
    await writeFile(path, 'abc', 'utf8')

    await expect(_internals.fileSha256(path)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
