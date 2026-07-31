import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeImGeneratedFiles, deliverImGeneratedFiles } from './im-attachment-pipeline'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('IM attachment pipeline', () => {
  it('authorizes readable workspace files, deduplicates them, and rejects escapes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-im-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'kun-im-outside-'))
    roots.push(workspace, outside)
    const allowedPath = join(workspace, 'report.txt')
    const outsidePath = join(outside, 'secret.txt')
    await writeFile(allowedPath, 'report')
    await writeFile(outsidePath, 'secret')
    const logError = vi.fn()

    const result = await authorizeImGeneratedFiles({
      files: [
        { path: allowedPath, fileName: '' },
        { path: allowedPath, fileName: 'duplicate.txt' },
        { path: outsidePath, fileName: 'secret.txt' },
        { path: join(workspace, 'missing.txt'), fileName: 'missing.txt' }
      ],
      workspaceRoot: workspace,
      logError
    })

    expect(result).toEqual([{ path: await realpath(allowedPath), fileName: 'report.txt' }])
    expect(logError).toHaveBeenCalledWith(
      'claw-im',
      'Skipping generated file outside the IM workspace',
      expect.objectContaining({ filePath: outsidePath })
    )
    expect(logError).toHaveBeenCalledWith(
      'claw-im',
      'Skipping generated file that cannot be read for IM upload',
      expect.objectContaining({ filePath: join(workspace, 'missing.txt') })
    )
  })

  it('continues uploading after one file fails and reports an exact partial result', async () => {
    const files = [
      { path: '/workspace/one.txt', fileName: 'one.txt' },
      { path: '/workspace/two.txt', fileName: 'two.txt' },
      { path: '/workspace/three.txt', fileName: 'three.txt' }
    ]
    const onFailure = vi.fn()
    const upload = vi.fn(async (file: { fileName: string }) => {
      if (file.fileName === 'two.txt') throw new Error('upload rejected')
    })

    const result = await deliverImGeneratedFiles({ files, upload, onFailure })

    expect(upload).toHaveBeenCalledTimes(3)
    expect(result.sent).toEqual([files[0], files[2]])
    expect(result.failed).toEqual([{ file: files[1], message: 'upload rejected' }])
    expect(onFailure).toHaveBeenCalledWith(files[1], 'upload rejected')
  })
})
