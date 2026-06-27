import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveKunImageGenerationSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  createImageGenClient,
  ImageGenHttpError,
  type ImageGenClient
} from '../../../kun/src/adapters/tool/image-gen-tool-provider.js'
import { detectImage } from '../../../kun/src/attachments/attachment-store.js'

const EDIT_IMAGE_TIMEOUT_MS = 300_000

export type ImageEditRequest = {
  originalImage: string
  maskImage: string
  prompt: string
}

export type ImageEditResult =
  | { ok: true; imageDataUrl: string }
  | { ok: false; error: string }

function dataUrlToBuffer(dataUrl: string): { data: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('invalid image data URL')
  }
  return {
    mimeType: match[1],
    data: Buffer.from(match[2], 'base64')
  }
}

function isImageGenerationConfigured(settings: AppSettingsV1): boolean {
  const imageGen = resolveKunImageGenerationSettings(settings)
  return (
    imageGen.enabled &&
    Boolean(imageGen.baseUrl.trim()) &&
    Boolean(imageGen.apiKey.trim()) &&
    Boolean(imageGen.model.trim())
  )
}

/**
 * 使用已配置的图片生成供应商对原图局部区域进行编辑。
 * 目前优先通过供应商的 images/edits 端点（支持 mask 的 OpenAI 兼容供应商）
 * 完成局部重绘；其他协议暂时以原图作为参考图调用 edits 端点，由模型
 * 根据提示词自行决定修改范围。
 */
export async function requestImageEdit(
  settings: AppSettingsV1,
  request: ImageEditRequest,
  options: { client?: ImageGenClient } = {}
): Promise<ImageEditResult> {
  if (!isImageGenerationConfigured(settings)) {
    return { ok: false, error: 'image generation provider is not configured' }
  }

  const imageGen = resolveKunImageGenerationSettings(settings)
  const client = options.client ?? createImageGenClient(imageGen)
  const model = imageGen.model

  let original: { data: Buffer; mimeType: string }
  let mask: { data: Buffer; mimeType: string }
  try {
    original = dataUrlToBuffer(request.originalImage)
    mask = dataUrlToBuffer(request.maskImage)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `invalid image data: ${error.message}` : 'invalid image data'
    }
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), EDIT_IMAGE_TIMEOUT_MS)

  try {
    const generated = await client.edit({
      prompt: request.prompt,
      model,
      timeoutMs: EDIT_IMAGE_TIMEOUT_MS,
      signal: abortController.signal,
      images: [
        {
          name: `original.${mimeToExt(original.mimeType)}`,
          mimeType: original.mimeType,
          data: original.data
        }
      ],
      mask: {
        name: `mask.${mimeToExt(mask.mimeType)}`,
        mimeType: mask.mimeType,
        data: mask.data
      }
    })

    clearTimeout(timeout)

    const detected = detectImage(generated.data)
    const mimeType = detected?.mimeType ?? generated.mimeType ?? 'image/png'
    const dataUrl = `data:${mimeType};base64,${generated.data.toString('base64')}`
    return { ok: true, imageDataUrl: dataUrl }
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof ImageGenHttpError) {
      return { ok: false, error: error.message }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function mimeToExt(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}
