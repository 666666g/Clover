import { z } from 'zod'
import {
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  type ModelRequestTracePage
} from '../../contracts/model-request-trace.js'
import { DEFAULT_LLM_DEBUG_RECORDER_LIMITS } from '../../services/llm-debug-recorder.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const ModelRequestsQuerySchema = z.object({
  limit: z.preprocess((value) => {
    if (value === null || value === '') return undefined
    return Number(value)
  }, z.number().int().positive().max(DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxPageSize).optional()),
  cursor: z.string().min(1).max(2_048).optional()
})

export async function modelRequestsResponse(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse> {
  if (!await runtime.threadService.get(threadId)) {
    return ERRORS.notFound(`thread not found: ${threadId}`)
  }
  const url = new URL(request.url)
  const parsed = ModelRequestsQuerySchema.safeParse({
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor') ?? undefined
  })
  if (!parsed.success) {
    return ERRORS.validation('invalid model request trace query', parsed.error.issues)
  }
  if (runtime.llmDebug) {
    return jsonResponse(await runtime.llmDebug.listThread(threadId, parsed.data))
  }
  const empty: ModelRequestTracePage = {
    schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
    records: [],
    activeCount: 0,
    limits: {
      maxRequestBodyBytes: DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxRequestBodyBytes,
      maxResponseBodyBytes: DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxResponseBodyBytes,
      maxPageSize: DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxPageSize
    },
    warnings: ['model request capture is unavailable in this runtime']
  }
  return jsonResponse(empty)
}
