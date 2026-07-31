import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { AppSettingsV1, WorkflowNodeV1 } from '../shared/app-settings'
import { resolveKunImageGenerationSettings } from '../shared/app-settings'
import {
  createImageGenClient,
  mapImageSize
} from '../../kun/src/adapters/tool/image-gen-tool-provider.js'
import { resolveCodexOAuthApiKey } from './codex-auth'
import { interpolate, type InterpScope, type WorkflowPayload } from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'

type ImageNode = Extract<WorkflowNodeV1, { type: 'generate-image' }>

function resolveImageSettings(settings: AppSettingsV1, providerRaw: string, modelRaw: string) {
  const providerId = providerRaw.trim()
  const model = modelRaw.trim()
  if (!providerId && !model) return resolveKunImageGenerationSettings(settings)
  return resolveKunImageGenerationSettings({
    ...settings,
    agents: {
      ...settings.agents,
      kun: {
        ...settings.agents.kun,
        imageGeneration: {
          ...settings.agents.kun.imageGeneration,
          ...(providerId ? { providerId } : {}),
          ...(model ? { model } : {})
        }
      }
    }
  })
}

function outputDirectory(workspace: string, configuredRaw: string): string {
  const configured = configuredRaw.trim()
  if (configured) {
    if (isAbsolute(configured)) return resolve(configured)
    if (!workspace) throw new Error('Output folder is relative but no workspace is configured.')
    return resolve(join(workspace, configured))
  }
  if (!workspace) throw new Error('No workspace configured to save the image — set an output folder on the node.')
  return join(workspace, 'workflow-images')
}

export async function executeImageWorkflowNode(input: {
  node: ImageNode
  payload: WorkflowPayload
  settings: AppSettingsV1
  runWorkspace: string
  scope: InterpScope
  signal?: AbortSignal
}): Promise<WorkflowNodeOutcome> {
  const { node, payload, settings, runWorkspace, scope } = input
  const imageGen = resolveImageSettings(settings, node.config.providerId, node.config.model)
  const nodeDriven = Boolean(node.config.providerId.trim() || node.config.model.trim())
  if (!imageGen.enabled && !nodeDriven) throw new Error('Image generation is not configured in Settings.')
  if (!imageGen.baseUrl.trim() || !imageGen.apiKey.trim() || !imageGen.model.trim()) {
    throw new Error('Image generation is missing a provider, API key, or model.')
  }
  const workspace = (runWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot).trim()
  const outputDir = outputDirectory(workspace, interpolate(node.config.outputDir, payload, scope))
  const auth = resolveCodexOAuthApiKey(imageGen.apiKey)
  const client = createImageGenClient({ ...imageGen, apiKey: auth.apiKey, ...(auth.headers ? { headers: auth.headers } : {}) })
  const size = node.config.size.trim() || imageGen.defaultSize.trim() || mapImageSize(undefined, undefined, undefined, imageGen.defaultResolution)
  const timeoutSignal = AbortSignal.timeout(imageGen.timeoutMs)
  const image = await client.generate({
    prompt: interpolate(node.config.prompt, payload, scope),
    model: imageGen.model.trim(),
    quality: imageGen.quality,
    ...(size && size !== 'auto' ? { size } : {}),
    timeoutMs: imageGen.timeoutMs,
    signal: input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal
  })
  const ext = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'
  await mkdir(outputDir, { recursive: true })
  const fileName = `image-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}.${ext}`
  const filePath = join(outputDir, fileName)
  await writeFile(filePath, image.data)
  return { payload: { json: { imagePath: filePath, mimeType: image.mimeType }, text: filePath }, message: `image saved: ${fileName}` }
}
