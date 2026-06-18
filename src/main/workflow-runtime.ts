import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isAbsolute, join, resolve } from 'node:path'
import { URL } from 'node:url'
import { compileFunction, runInNewContext } from 'node:vm'
import type {
  AppSettingsV1,
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowConditionConfigV1,
  WorkflowConnectionV1,
  WorkflowHttpRequestConfigV1,
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowRunV1,
  WorkflowRuntimeStatus,
  WorkflowScheduleV1,
  WorkflowV1
} from '../shared/app-settings'
import { resolveKunImageGenerationSettings } from '../shared/app-settings'
import { MAX_WORKFLOW_RUNS } from '../shared/app-settings-workflow'
import {
  SCHEDULER_INTERVAL_MS,
  hasEnabledScheduledTask,
  parseJsonObject,
  readRequestBody,
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  sleep,
  summarizeTaskResult,
  writeJson,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'

const MAX_NODE_EXECUTIONS = 200
const MAX_RUN_DURATION_MS = 30 * 60_000
/** Sentinel branch that matches no output handle (e.g. switch with no rule + no fallback). */
const NO_BRANCH = '__none__'
const AI_NODE_RESPONSE_TIMEOUT_MS = 30 * 60_000
const HTTP_MAX_RESPONSE_BYTES = 5_000_000
const LIVE_STATUS_LINGER_MS = 8_000

type WorkflowPayload = { json: unknown; text: string }
type ScheduleTriggerNode = Extract<WorkflowNodeV1, { type: 'schedule-trigger' }>

type NodeOutcome = {
  payload: WorkflowPayload
  message: string
  /** For condition nodes: which outgoing handle to follow ('true' | 'false'). */
  branch?: string
  /** For ai-agent nodes: the Kun thread created. */
  threadId?: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isScheduleTrigger(node: WorkflowNodeV1): node is ScheduleTriggerNode {
  return node.type === 'schedule-trigger'
}

function activeScheduleTriggers(workflow: WorkflowV1): ScheduleTriggerNode[] {
  return workflow.nodes
    .filter(isScheduleTrigger)
    .filter((node) => !node.disabled && node.config.schedule.kind !== 'manual')
}

export function workflowHasScheduleTrigger(workflow: WorkflowV1): boolean {
  return activeScheduleTriggers(workflow).length > 0
}

export function hasEnabledScheduledWorkflow(settings: AppSettingsV1): boolean {
  return settings.workflow.workflows.some((workflow) => workflow.enabled && workflowHasScheduleTrigger(workflow))
}

/** Minimal, dependency-free 5-field cron field parser ("* , - /"). */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const match = part.trim().match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!match) return null
    const star = match[1] === '*'
    const lo = star ? min : Number(match[1])
    const hi = star ? max : match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? max : lo
    const step = match[3] !== undefined ? Number(match[3]) : 1
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || step < 1) return null
    for (let value = lo; value <= hi; value += step) {
      if (value >= min && value <= max) out.add(value)
    }
  }
  return out.size ? out : null
}

/** Next fire time at or after `from` for a standard "min hour dom month dow" cron, in local time. */
export function cronNextRun(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseCronField(parts[0], 0, 59)
  const hours = parseCronField(parts[1], 0, 23)
  const doms = parseCronField(parts[2], 1, 31)
  const months = parseCronField(parts[3], 1, 12)
  const dowsRaw = parseCronField(parts[4], 0, 7)
  if (!minutes || !hours || !doms || !months || !dowsRaw) return null
  const dows = new Set([...dowsRaw].map((day) => (day === 7 ? 0 : day)))
  const domRestricted = parts[2].trim() !== '*'
  const dowRestricted = parts[4].trim() !== '*'

  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = 366 * 24 * 60
  for (let i = 0; i < limit; i += 1) {
    if (months.has(cursor.getMonth() + 1)) {
      const dom = cursor.getDate()
      const dow = cursor.getDay()
      // Standard cron: when both DOM and DOW are restricted, match either.
      const dayOk =
        domRestricted && dowRestricted
          ? doms.has(dom) || dows.has(dow)
          : (domRestricted ? doms.has(dom) : true) && (dowRestricted ? dows.has(dow) : true)
      if (dayOk && hours.has(cursor.getHours()) && minutes.has(cursor.getMinutes())) {
        return new Date(cursor.getTime())
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

function nextRunFromSchedule(schedule: WorkflowScheduleV1, from: Date): string {
  switch (schedule.kind) {
    case 'manual':
      return ''
    case 'at':
      return schedule.atTime.trim()
    case 'interval':
      return new Date(from.getTime() + schedule.everyMinutes * 60_000).toISOString()
    case 'cron': {
      const next = schedule.cron.trim() ? cronNextRun(schedule.cron, from) : null
      return next ? next.toISOString() : ''
    }
    case 'daily':
    default: {
      const [hourRaw, minuteRaw] = schedule.timeOfDay.split(':')
      const hour = Number(hourRaw)
      const minute = Number(minuteRaw)
      const next = new Date(from)
      next.setSeconds(0, 0)
      next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
      if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
      return next.toISOString()
    }
  }
}

export function computeWorkflowNextRunAt(workflow: WorkflowV1, from: Date): string {
  if (!workflow.enabled) return ''
  const candidates = activeScheduleTriggers(workflow)
    .map((node) => nextRunFromSchedule(node.config.schedule, from).trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort()
  return candidates[0] ?? ''
}

function buildAdjacency(connections: WorkflowConnectionV1[]): Map<string, WorkflowConnectionV1[]> {
  const map = new Map<string, WorkflowConnectionV1[]>()
  for (const edge of connections) {
    const list = map.get(edge.source) ?? []
    list.push(edge)
    map.set(edge.source, list)
  }
  return map
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function readPath(payload: WorkflowPayload, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed || trimmed === 'text') return payload.text
  if (trimmed === 'json') return payload.json
  const segments = trimmed.replace(/^json\.?/, '').split('.').filter(Boolean)
  let cursor: unknown = payload.json
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return cursor
}

/** Drill into a value by a dot-path (e.g. "user.name"); empty path returns the value itself. */
function getByPath(value: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed) return value
  const segments = trimmed.replace(/^json\.?/, '').split('.').filter(Boolean)
  let cursor: unknown = value
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return cursor
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : safeJson(value)
}

function interpolate(template: string, payload: WorkflowPayload): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => stringifyValue(readPath(payload, expr)))
}

function evaluateCondition(config: WorkflowConditionConfigV1, payload: WorkflowPayload): boolean {
  const leftRaw = config.leftExpr.trim() ? readPath(payload, config.leftExpr) : payload.text
  const left = stringifyValue(leftRaw)
  const right = config.rightValue
  const l = config.caseSensitive ? left : left.toLowerCase()
  const r = config.caseSensitive ? right : right.toLowerCase()
  switch (config.operator) {
    case 'contains':
      return l.includes(r)
    case 'notContains':
      return !l.includes(r)
    case 'equals':
      return l === r
    case 'notEquals':
      return l !== r
    case 'startsWith':
      return l.startsWith(r)
    case 'endsWith':
      return l.endsWith(r)
    case 'isEmpty':
      return left.trim() === ''
    case 'isNotEmpty':
      return left.trim() !== ''
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

async function readBodyCapped(response: Response, limit: number): Promise<string> {
  const body = response.body
  if (!body) return response.text()
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      size += value.length
      if (size > limit) {
        await reader.cancel()
        throw new Error('Response body exceeds the 5MB limit.')
      }
      chunks.push(Buffer.from(value))
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function runHttpNode(config: WorkflowHttpRequestConfigV1, payload: WorkflowPayload): Promise<NodeOutcome> {
  const url = interpolate(config.url, payload).trim()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url || '(empty)'}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.')
  }
  const headers: Record<string, string> = {}
  for (const header of config.headers) {
    const key = header.key.trim()
    if (key) headers[key] = interpolate(header.value, payload)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const init: RequestInit = { method: config.method, headers, signal: controller.signal }
    if (config.method !== 'GET' && config.method !== 'DELETE' && config.body.trim()) {
      init.body = interpolate(config.body, payload)
    }
    const response = await fetch(url, init)
    const raw = await readBodyCapped(response, HTTP_MAX_RESPONSE_BYTES)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`)
    }
    let json: unknown = { status: response.status, body: raw }
    if (config.parseJson) {
      try {
        json = JSON.parse(raw)
      } catch {
        json = { status: response.status, body: raw }
      }
    }
    return { payload: { json, text: raw }, message: `${response.status} ${response.statusText}`.trim() }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${config.timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const CODE_TIMEOUT_MS = 2_000
/** python/bash scripts may do real work (network, files), so they get longer than the JS sandbox. */
const COMMAND_TIMEOUT_MS = 30_000
const PYTHON_BIN = process.env.WORKFLOW_PYTHON_BIN?.trim() || 'python3'
const MAX_SUBWORKFLOW_DEPTH = 5

function runCodeNode(code: string, payload: WorkflowPayload): NodeOutcome {
  const sandbox: Record<string, unknown> = { $json: payload.json, $text: payload.text, __result: undefined }
  try {
    runInNewContext(`__result = (function(){\n${code}\n})()`, sandbox, {
      timeout: CODE_TIMEOUT_MS,
      displayErrors: true
    })
  } catch (error) {
    throw new Error(`Code error: ${error instanceof Error ? error.message : String(error)}`)
  }
  const out = sandbox.__result
  if (out === undefined || out === null) return { payload: { json: {}, text: '' }, message: 'ok' }
  if (typeof out === 'string') return { payload: { json: { value: out }, text: out }, message: 'ok' }
  const json = typeof out === 'object' ? out : { value: out }
  return { payload: { json, text: safeJson(json) }, message: 'ok' }
}

/**
 * Run a python or bash script in a child process. The script reads its input on
 * stdin as JSON ({ json, text }) and via the $WORKFLOW_JSON / $WORKFLOW_TEXT env
 * vars; whatever it writes to stdout becomes the node output (parsed as JSON when
 * the whole stdout is a JSON object/array, otherwise passed through as text).
 */
function runCommandNode(
  language: 'python' | 'bash',
  code: string,
  payload: WorkflowPayload
): Promise<NodeOutcome> {
  const bin = language === 'python' ? PYTHON_BIN : 'bash'
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-c', code], {
      env: { ...process.env, WORKFLOW_TEXT: payload.text ?? '', WORKFLOW_JSON: safeJson(payload.json) }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`${language} script timed out after ${COMMAND_TIMEOUT_MS}ms`)))
    }, COMMAND_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      const reason =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? `${bin} was not found on this machine`
          : error.message
      finish(() => reject(new Error(`${language} error: ${reason}`)))
    })
    child.on('close', (exitCode) => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(`${language} exited with code ${exitCode}: ${(stderr || stdout).trim().slice(0, 500)}`))
          return
        }
        const out = stdout.trim()
        let parsed: unknown
        try {
          parsed = out ? JSON.parse(out) : undefined
        } catch {
          parsed = undefined
        }
        if (parsed !== null && typeof parsed === 'object') {
          resolve({ payload: { json: parsed, text: out }, message: 'ok' })
        } else {
          resolve({ payload: { json: out ? { text: out } : {}, text: out }, message: 'ok' })
        }
      })
    })
    // Scripts that never read stdin trigger EPIPE on write — ignore it.
    child.stdin.on('error', () => {})
    child.stdin.write(JSON.stringify({ json: payload.json, text: payload.text }))
    child.stdin.end()
  })
}

/**
 * Resolve the image-generation config for a generate-image node. When the node
 * picks its own provider/model we patch them into the runtime image config and
 * reuse the shared resolver, so a node-selected provider goes through the exact
 * same provider→image-capability resolution as the global Settings path. Empty
 * fields fall back to whatever is configured in Settings.
 */
function resolveWorkflowImageGen(
  settings: AppSettingsV1,
  nodeProviderId: string,
  nodeModel: string
): ReturnType<typeof resolveKunImageGenerationSettings> {
  const providerId = nodeProviderId.trim()
  const model = nodeModel.trim()
  if (!providerId && !model) return resolveKunImageGenerationSettings(settings)
  const kun = settings.agents.kun
  const patched: AppSettingsV1 = {
    ...settings,
    agents: {
      ...settings.agents,
      kun: {
        ...kun,
        imageGeneration: {
          ...kun.imageGeneration,
          ...(providerId ? { providerId } : {}),
          ...(model ? { model } : {})
        }
      }
    }
  }
  return resolveKunImageGenerationSettings(patched)
}

/**
 * Editor-time syntax check for a Code node. JavaScript compiles in-process
 * (never executed); python/bash are parse-checked with the local interpreter
 * (`ast.parse` / `bash -n`). A missing interpreter returns `unavailable` rather
 * than a hard error so the editor can show a soft note.
 */
export function checkWorkflowCode(language: WorkflowCodeLanguage, code: string): Promise<WorkflowCodeCheckResult> {
  if (!code.trim()) return Promise.resolve({ status: 'ok' })
  if (language === 'javascript') {
    try {
      // Compiles the function body without running it — surfaces SyntaxError only.
      compileFunction(code, ['$json', '$text'])
      return Promise.resolve({ status: 'ok' })
    } catch (error) {
      return Promise.resolve({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const bin = language === 'python' ? PYTHON_BIN : 'bash'
  const args = language === 'python' ? ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'] : ['-n']
  return new Promise((resolveResult) => {
    let settled = false
    const done = (result: WorkflowCodeCheckResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args)
    } catch {
      done({ status: 'unavailable', message: `${bin} is not available — cannot check ${language} syntax.` })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      done({ status: 'error', message: 'Syntax check timed out.' })
    }, 8_000)
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      done(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { status: 'unavailable', message: `${bin} was not found — cannot check ${language} syntax.` }
          : { status: 'error', message: error.message }
      )
    })
    child.on('close', (exitCode) => {
      done(
        exitCode === 0
          ? { status: 'ok' }
          : { status: 'error', message: stderr.trim().slice(0, 800) || `Exited with code ${exitCode}.` }
      )
    })
    child.stdin?.on('error', () => {})
    child.stdin?.write(code)
    child.stdin?.end()
  })
}

/**
 * Resolve where a generate-image node saves its file. Absolute paths are used
 * as-is; relative paths resolve against the workspace; empty defaults to
 * <workspace>/workflow-images.
 */
function resolveImageOutputDir(workspace: string, configuredRaw: string): string {
  const configured = configuredRaw.trim()
  if (configured) {
    if (isAbsolute(configured)) return resolve(configured)
    if (!workspace) throw new Error('Output folder is relative but no workspace is configured.')
    return resolve(join(workspace, configured))
  }
  if (!workspace) {
    throw new Error('No workspace configured to save the image — set an output folder on the node.')
  }
  return join(workspace, 'workflow-images')
}

function summarizeRun(results: WorkflowNodeRunResultV1[]): string {
  const lastMeaningful = [...results].reverse().find((result) => result.status === 'success' && result.message.trim())
  if (lastMeaningful) return lastMeaningful.message
  return `Completed ${results.length} step${results.length === 1 ? '' : 's'}`
}

function hasEnabledWebhook(settings: AppSettingsV1): boolean {
  return settings.workflow.workflows.some(
    (workflow) => workflow.enabled && workflow.nodes.some((node) => node.type === 'webhook-trigger' && !node.disabled)
  )
}

// ---------------------------------------------------------------------------
// WorkflowRuntime
// ---------------------------------------------------------------------------

export class WorkflowRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private runningWorkflowIds = new Set<string>()
  private cancelRequested = new Set<string>()
  /** workflowId -> nodeId -> live status, surfaced to the canvas via status(). */
  private liveNodeStatus = new Map<string, Map<string, WorkflowNodeRunStatus>>()
  private powerSaveBlockerId: number | null = null
  private webhookServer: Server | null = null
  private webhookServerKey = ''

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    this.syncWebhookServer(settings)
    void this.ensureNextRuns(settings)
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.stopPowerSaveBlocker()
    this.closeWebhookServer()
  }

  private syncWebhookServer(settings: AppSettingsV1): void {
    const shouldListen = settings.workflow.enabled && hasEnabledWebhook(settings)
    if (!shouldListen) {
      this.closeWebhookServer()
      return
    }
    const key = String(settings.workflow.webhookPort)
    if (this.webhookServer && this.webhookServerKey === key) return
    this.closeWebhookServer()
    const server = createServer((req, res) => {
      void this.handleWebhookRequest(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('workflow-webhook', 'Webhook server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.webhookServer === server) this.closeWebhookServer()
    })
    // Bind to localhost only — never expose the listener to the network.
    server.listen(settings.workflow.webhookPort, '127.0.0.1')
    this.webhookServer = server
    this.webhookServerKey = key
  }

  private closeWebhookServer(): void {
    if (!this.webhookServer) return
    const server = this.webhookServer
    this.webhookServer = null
    this.webhookServerKey = ''
    server.close()
  }

  private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const secret = settings.workflow.webhookSecret.trim()
      if (secret) {
        const rawHeader = req.headers['x-kun-secret']
        const headerSecret = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
        if (req.headers.authorization !== `Bearer ${secret}` && headerSecret !== secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }
      const method = req.method ?? 'GET'
      let match: { workflow: WorkflowV1; nodeId: string } | null = null
      for (const workflow of settings.workflow.workflows) {
        if (!workflow.enabled) continue
        for (const node of workflow.nodes) {
          if (node.type !== 'webhook-trigger' || node.disabled) continue
          if (node.config.path !== pathname) continue
          if (node.config.method !== 'ANY' && node.config.method !== method) continue
          match = { workflow, nodeId: node.id }
          break
        }
        if (match) break
      }
      if (!match) {
        writeJson(res, 404, { ok: false, message: 'No enabled workflow matches this webhook.' })
        return
      }
      const body = await readRequestBody(req)
      const parsed = parseJsonObject(body)
      const runId = randomUUID()
      void this.runWorkflowInternal(match.workflow, match.nodeId, 'webhook', runId, {
        json: parsed ?? body,
        text: body
      })
      writeJson(res, 200, { ok: true, runId })
    } catch (error) {
      this.deps.logError('workflow-webhook', 'Webhook request failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      try {
        writeJson(res, 500, { ok: false, message: 'Internal error.' })
      } catch {
        /* response already sent */
      }
    }
  }

  async status(): Promise<WorkflowRuntimeStatus> {
    const nodeStatus: Record<string, Record<string, WorkflowNodeRunStatus>> = {}
    for (const [workflowId, map] of this.liveNodeStatus) {
      nodeStatus[workflowId] = Object.fromEntries(map)
    }
    return {
      runningWorkflowIds: [...this.runningWorkflowIds],
      nodeStatus,
      powerSaveBlockerActive: this.isPowerSaveBlockerActive()
    }
  }

  async runWorkflow(workflowId: string): Promise<WorkflowRunResult> {
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    if (this.runningWorkflowIds.has(workflowId)) return { ok: false, message: 'Workflow is already running.' }
    const trigger =
      workflow.nodes.find((node) => node.type === 'manual-trigger') ??
      workflow.nodes.find((node) => node.type === 'schedule-trigger') ??
      workflow.nodes.find((node) => node.type === 'webhook-trigger')
    if (!trigger) return { ok: false, message: 'Workflow has no trigger node.' }
    const runId = randomUUID()
    // Fire-and-poll: the UI watches status() for per-node progress.
    void this.runWorkflowInternal(workflow, trigger.id, 'manual', runId)
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  async stopWorkflow(workflowId: string): Promise<WorkflowRunResult> {
    if (!this.runningWorkflowIds.has(workflowId)) return { ok: false, message: 'Workflow is not running.' }
    this.cancelRequested.add(workflowId)
    return { ok: true, runId: '', status: 'running', message: 'Stopping' }
  }

  async runSingleNode(workflowId: string, nodeId: string): Promise<WorkflowRunResult> {
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, message: 'Node not found.' }
    const runId = randomUUID()
    void (async () => {
      const live = new Map<string, WorkflowNodeRunStatus>([[nodeId, 'running']])
      this.liveNodeStatus.set(workflowId, live)
      try {
        await this.executeNode(node, { json: {}, text: '' }, settings)
        live.set(nodeId, 'success')
      } catch {
        live.set(nodeId, 'error')
      } finally {
        setTimeout(() => this.liveNodeStatus.delete(workflowId), LIVE_STATUS_LINGER_MS)
      }
    })()
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  private startScheduler(): void {
    if (this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.tick()
    }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref?.()
    void this.tick()
  }

  private async tick(): Promise<void> {
    const settings = await this.deps.store.load()
    if (!settings.workflow.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    for (const workflow of fresh.workflow.workflows) {
      if (!workflow.enabled || this.runningWorkflowIds.has(workflow.id)) continue
      const trigger = activeScheduleTriggers(workflow)[0]
      if (!trigger) continue
      const dueAt = Date.parse(workflow.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runWorkflowInternal(workflow, trigger.id, 'schedule')
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    if (!settings.workflow.enabled) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    let changed = false
    const now = new Date()
    const workflows = settings.workflow.workflows.map((workflow) => {
      const wasInterrupted = workflow.lastStatus === 'running' && !this.runningWorkflowIds.has(workflow.id)
      const scheduled = workflowHasScheduleTrigger(workflow)
      if (!workflow.enabled || !scheduled || this.runningWorkflowIds.has(workflow.id)) {
        if (!wasInterrupted) return workflow
        changed = true
        return {
          ...workflow,
          lastStatus: 'error' as const,
          lastMessage: 'Workflow was interrupted before completion.',
          updatedAt: now.toISOString()
        }
      }
      if (workflow.nextRunAt && !wasInterrupted) return workflow
      changed = true
      return {
        ...workflow,
        nextRunAt: computeWorkflowNextRunAt(workflow, now),
        ...(wasInterrupted
          ? {
              lastStatus: 'error' as const,
              lastMessage: 'Workflow was interrupted before completion.',
              updatedAt: now.toISOString()
            }
          : {})
      }
    })
    if (!changed) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    const saved = await this.deps.store.patch({ workflow: { ...settings.workflow, workflows } })
    this.syncPowerSaveBlocker(saved)
  }

  private async updateWorkflow(
    workflowId: string,
    updater: (workflow: WorkflowV1) => WorkflowV1
  ): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    const workflows = settings.workflow.workflows.map((workflow) =>
      workflow.id === workflowId ? updater(workflow) : workflow
    )
    const saved = await this.deps.store.patch({ workflow: { ...settings.workflow, workflows } })
    this.syncPowerSaveBlocker(saved)
    return saved
  }

  private setLive(workflowId: string, nodeId: string, status: WorkflowNodeRunStatus): void {
    const map = this.liveNodeStatus.get(workflowId) ?? new Map<string, WorkflowNodeRunStatus>()
    map.set(nodeId, status)
    this.liveNodeStatus.set(workflowId, map)
  }

  private async runWorkflowInternal(
    workflow: WorkflowV1,
    triggerNodeId: string,
    triggerLabel: string,
    runId = randomUUID(),
    initialPayload: WorkflowPayload = { json: {}, text: '' }
  ): Promise<WorkflowRunResult> {
    if (this.runningWorkflowIds.has(workflow.id)) {
      return { ok: false, message: 'Workflow is already running.' }
    }
    this.runningWorkflowIds.add(workflow.id)
    this.cancelRequested.delete(workflow.id)

    const liveStatus = new Map<string, WorkflowNodeRunStatus>()
    workflow.nodes.forEach((node) => liveStatus.set(node.id, 'pending'))
    this.liveNodeStatus.set(workflow.id, liveStatus)

    const startedAt = new Date()
    const run: WorkflowRunV1 = {
      id: runId,
      trigger: triggerLabel,
      status: 'running',
      startedAt: startedAt.toISOString(),
      finishedAt: '',
      message: '',
      nodeResults: []
    }
    await this.updateWorkflow(workflow.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: startedAt.toISOString(),
      runs: [...current.runs, run].slice(-MAX_WORKFLOW_RUNS)
    }))

    let runStatus: WorkflowRunStatus = 'success'
    let runMessage = ''
    let nodeResults: WorkflowNodeRunResultV1[] = []
    try {
      const settings = await this.deps.store.load()
      const result = await this.runGraph(workflow, triggerNodeId, initialPayload, {
        settings,
        statusWorkflowId: workflow.id,
        cancelId: workflow.id,
        depth: 0
      })
      runStatus = result.status
      nodeResults = result.nodeResults
      runMessage = runStatus === 'success' ? summarizeRun(nodeResults) : result.errorMessage
    } catch (error) {
      runStatus = 'error'
      runMessage = error instanceof Error ? error.message : String(error)
      this.deps.logError('workflow', 'Workflow run failed', { message: runMessage, workflowId: workflow.id })
    } finally {
      const finishedAt = new Date()
      await this.updateWorkflow(workflow.id, (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        lastStatus: runStatus,
        lastMessage: runMessage,
        nextRunAt: computeWorkflowNextRunAt(current, finishedAt),
        updatedAt: finishedAt.toISOString(),
        runs: current.runs.map((entry) =>
          entry.id === runId
            ? { ...entry, status: runStatus, finishedAt: finishedAt.toISOString(), message: runMessage, nodeResults }
            : entry
        )
      }))
      this.runningWorkflowIds.delete(workflow.id)
      this.cancelRequested.delete(workflow.id)
      setTimeout(() => this.liveNodeStatus.delete(workflow.id), LIVE_STATUS_LINGER_MS)
    }
    return { ok: runStatus !== 'error', runId, status: runStatus, message: runMessage }
  }

  /**
   * Pruning dataflow scheduler over one workflow graph. A node runs once all its
   * incoming edges are resolved (delivered a payload, or pruned). Conditions /
   * switches prune the branches they don't take, cascading to make downstream
   * nodes unreachable — so joins (Merge) wait only for branches that fire.
   * Pure: no persistence. Used by both top-level runs and sub-workflow nodes.
   */
  private async runGraph(
    workflow: WorkflowV1,
    triggerNodeId: string,
    initialPayload: WorkflowPayload,
    ctx: { settings: AppSettingsV1; statusWorkflowId?: string; cancelId?: string; depth: number }
  ): Promise<{
    status: WorkflowRunStatus
    errorMessage: string
    nodeResults: WorkflowNodeRunResultV1[]
    output: WorkflowPayload
  }> {
    const { settings } = ctx
    const setLive = (nodeId: string, status: WorkflowNodeRunStatus): void => {
      if (ctx.statusWorkflowId) this.setLive(ctx.statusWorkflowId, nodeId, status)
    }
    const isCanceled = (): boolean => (ctx.cancelId ? this.cancelRequested.has(ctx.cancelId) : false)

    const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]))
    const outEdges = new Map<string, WorkflowConnectionV1[]>()
    const inEdges = new Map<string, WorkflowConnectionV1[]>()
    for (const edge of workflow.connections) {
      const outList = outEdges.get(edge.source) ?? []
      outList.push(edge)
      outEdges.set(edge.source, outList)
      const inList = inEdges.get(edge.target) ?? []
      inList.push(edge)
      inEdges.set(edge.target, inList)
    }

    const nodeResults: WorkflowNodeRunResultV1[] = []
    const delivered = new Set<string>()
    const prunedEdges = new Set<string>()
    const payloadByEdge = new Map<string, WorkflowPayload>()
    const settledNodes = new Set<string>()
    const readyQueue: string[] = []
    const deadline = Date.now() + MAX_RUN_DURATION_MS
    let executions = 0
    let status: WorkflowRunStatus = 'success'
    let errorMessage = ''
    let output = initialPayload

    const incoming = (nodeId: string): WorkflowConnectionV1[] => inEdges.get(nodeId) ?? []
    const edgeResolved = (edge: WorkflowConnectionV1): boolean =>
      delivered.has(edge.id) || prunedEdges.has(edge.id)
    const allResolved = (nodeId: string): boolean => incoming(nodeId).every(edgeResolved)
    const hasLiveInput = (nodeId: string): boolean => incoming(nodeId).some((edge) => delivered.has(edge.id))
    const markReady = (nodeId: string): void => {
      if (!settledNodes.has(nodeId) && !readyQueue.includes(nodeId)) readyQueue.push(nodeId)
    }
    function pruneEdge(edge: WorkflowConnectionV1): void {
      if (delivered.has(edge.id) || prunedEdges.has(edge.id)) return
      prunedEdges.add(edge.id)
      settleTarget(edge.target)
    }
    function pruneNode(nodeId: string): void {
      if (settledNodes.has(nodeId)) return
      settledNodes.add(nodeId)
      for (const edge of outEdges.get(nodeId) ?? []) pruneEdge(edge)
    }
    function settleTarget(nodeId: string): void {
      if (settledNodes.has(nodeId) || !allResolved(nodeId)) return
      if (hasLiveInput(nodeId)) markReady(nodeId)
      else pruneNode(nodeId)
    }
    const handleActive = (outcome: NodeOutcome | null, sourceHandle: string): boolean => {
      if (!outcome || outcome.branch === undefined) return true
      return sourceHandle === outcome.branch
    }

    markReady(triggerNodeId)
    try {
      while (readyQueue.length > 0) {
        if (isCanceled()) {
          status = 'error'
          errorMessage = 'Canceled.'
          break
        }
        if (Date.now() > deadline) {
          status = 'error'
          errorMessage = 'Workflow exceeded the maximum run duration.'
          break
        }
        if (executions >= MAX_NODE_EXECUTIONS) {
          status = 'error'
          errorMessage = 'Workflow exceeded the maximum node count.'
          break
        }
        const nodeId = readyQueue.shift()
        if (!nodeId || settledNodes.has(nodeId)) continue
        const node = nodeById.get(nodeId)
        settledNodes.add(nodeId)
        if (!node) continue
        executions += 1

        const inputs = incoming(nodeId)
          .filter((edge) => delivered.has(edge.id))
          .map((edge) => payloadByEdge.get(edge.id))
          .filter((value): value is WorkflowPayload => Boolean(value))
        const primary = inputs[0] ?? (nodeId === triggerNodeId ? initialPayload : { json: {}, text: '' })

        let outcome: NodeOutcome | null
        if (node.disabled) {
          setLive(node.id, 'skipped')
          outcome = null
        } else {
          setLive(node.id, 'running')
          const nodeStartedAt = new Date()
          try {
            const produced = await this.executeNode(node, primary, settings, inputs.length ? inputs : [primary], ctx.depth)
            nodeResults.push({
              nodeId: node.id,
              status: 'success',
              startedAt: nodeStartedAt.toISOString(),
              finishedAt: new Date().toISOString(),
              message: produced.message,
              outputJson: safeJson(produced.payload.json),
              threadId: produced.threadId ?? '',
              error: ''
            })
            setLive(node.id, 'success')
            outcome = produced
            output = produced.payload
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            nodeResults.push({
              nodeId: node.id,
              status: 'error',
              startedAt: nodeStartedAt.toISOString(),
              finishedAt: new Date().toISOString(),
              message: '',
              outputJson: '',
              threadId: '',
              error: message
            })
            setLive(node.id, 'error')
            status = 'error'
            errorMessage = message
            break
          }
        }

        const outPayload = outcome ? outcome.payload : primary
        const edges = outEdges.get(node.id) ?? []
        for (const edge of edges) {
          if (handleActive(outcome, edge.sourceHandle || 'out')) {
            delivered.add(edge.id)
            payloadByEdge.set(edge.id, outPayload)
          } else {
            prunedEdges.add(edge.id)
          }
        }
        for (const edge of edges) settleTarget(edge.target)
      }
    } catch (error) {
      status = 'error'
      errorMessage = error instanceof Error ? error.message : String(error)
      this.deps.logError('workflow', 'Workflow graph failed', { message: errorMessage, workflowId: workflow.id })
    }

    return { status, errorMessage, nodeResults, output }
  }

  private async executeNode(
    node: WorkflowNodeV1,
    payload: WorkflowPayload,
    settings: AppSettingsV1,
    inputs: WorkflowPayload[] = [payload],
    depth = 0
  ): Promise<NodeOutcome> {
    switch (node.type) {
      case 'manual-trigger':
      case 'schedule-trigger':
      case 'webhook-trigger':
        // Triggers emit the run's initial payload (e.g. a webhook request body).
        return { payload, message: 'Triggered' }
      case 'ai-agent': {
        const modelConfig = resolveScheduleModelConfig(
          settings,
          {
            providerId: node.config.providerId,
            model: node.config.model,
            reasoningEffort: node.config.reasoningEffort
          },
          settings.workflow.providerId?.trim() || ''
        )
        const workspace =
          node.config.workspaceRoot.trim() ||
          settings.workflow.defaultWorkspaceRoot.trim() ||
          settings.workspaceRoot
        const result = await runPromptViaRuntime(this.deps, settings, {
          prompt: interpolate(node.config.prompt, payload),
          title: `[Workflow] ${node.name || 'AI task'}`.trim(),
          workspaceRoot: workspace,
          model: modelConfig.model,
          reasoningEffort: modelConfig.reasoningEffort,
          mode: node.config.mode,
          waitForResult: true,
          responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS
        })
        if (!result.ok) throw new Error(result.message)
        const text = result.text ?? ''
        return { payload: { json: { text }, text }, message: summarizeTaskResult(text), threadId: result.threadId }
      }
      case 'generate-image': {
        const imageGen = resolveWorkflowImageGen(settings, node.config.providerId, node.config.model)
        // A node that names its own provider/model opts itself in, even if the
        // global image toggle is off; otherwise require the Settings switch.
        const nodeDriven = Boolean(node.config.providerId.trim() || node.config.model.trim())
        if (!imageGen.enabled && !nodeDriven) {
          throw new Error('Image generation is not configured in Settings.')
        }
        if (!imageGen.baseUrl.trim() || !imageGen.apiKey.trim() || !imageGen.model.trim()) {
          throw new Error('Image generation is missing a provider, API key, or model.')
        }
        const workspace = (settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot).trim()
        const outputDir = resolveImageOutputDir(workspace, interpolate(node.config.outputDir, payload))
        // Lazy import keeps the kun image module out of the unit-test graph.
        const { createImageGenClient } = await import('../../kun/src/adapters/tool/image-gen-tool-provider.js')
        const client = createImageGenClient(imageGen)
        const size = node.config.size.trim() || imageGen.defaultSize.trim()
        const image = await client.generate({
          prompt: interpolate(node.config.prompt, payload),
          model: imageGen.model.trim(),
          ...(size && size !== 'auto' ? { size } : {}),
          timeoutMs: imageGen.timeoutMs,
          signal: AbortSignal.timeout(imageGen.timeoutMs)
        })
        const ext = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'
        await mkdir(outputDir, { recursive: true })
        const fileName = `image-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}.${ext}`
        const filePath = join(outputDir, fileName)
        await writeFile(filePath, image.data)
        return {
          payload: { json: { imagePath: filePath, mimeType: image.mimeType }, text: filePath },
          message: `image saved: ${fileName}`
        }
      }
      case 'condition': {
        const matched = evaluateCondition(node.config, payload)
        return { payload, message: matched ? 'true' : 'false', branch: matched ? 'true' : 'false' }
      }
      case 'switch': {
        for (let index = 0; index < node.config.rules.length; index += 1) {
          if (evaluateCondition(node.config.rules[index], payload)) {
            return { payload, message: `case ${index + 1}`, branch: `case-${index}` }
          }
        }
        return {
          payload,
          message: node.config.fallback ? 'fallback' : 'no match',
          branch: node.config.fallback ? 'fallback' : NO_BRANCH
        }
      }
      case 'code':
        return node.config.language === 'python' || node.config.language === 'bash'
          ? runCommandNode(node.config.language, node.config.code, payload)
          : runCodeNode(node.config.code, payload)
      case 'subworkflow': {
        if (depth >= MAX_SUBWORKFLOW_DEPTH) throw new Error('Sub-workflow nesting is too deep.')
        const target = settings.workflow.workflows.find((workflow) => workflow.id === node.config.workflowId)
        if (!target) throw new Error('Sub-workflow not found.')
        const trigger =
          target.nodes.find((item) => item.type === 'manual-trigger') ??
          target.nodes.find((item) => item.type === 'schedule-trigger')
        if (!trigger) throw new Error('Sub-workflow has no trigger node.')
        const result = await this.runGraph(target, trigger.id, payload, { settings, depth: depth + 1 })
        if (result.status === 'error') throw new Error(result.errorMessage || 'Sub-workflow failed.')
        return { payload: result.output, message: `ran ${target.name || 'sub-workflow'}` }
      }
      case 'loop': {
        if (depth >= MAX_SUBWORKFLOW_DEPTH) throw new Error('Loop nesting is too deep.')
        const target = settings.workflow.workflows.find((workflow) => workflow.id === node.config.workflowId)
        if (!target) throw new Error('Loop body workflow not found.')
        const trigger =
          target.nodes.find((item) => item.type === 'manual-trigger') ??
          target.nodes.find((item) => item.type === 'schedule-trigger') ??
          target.nodes.find((item) => item.type === 'webhook-trigger')
        if (!trigger) throw new Error('Loop body has no trigger node.')
        const stopCondition = {
          leftExpr: node.config.leftExpr,
          operator: node.config.operator,
          rightValue: node.config.rightValue,
          caseSensitive: node.config.caseSensitive
        }
        // Loop agent: run the body, feed its output back in, until the stop
        // condition holds or maxIterations caps it.
        let current = payload
        let iterations = 0
        let done = false
        while (iterations < node.config.maxIterations) {
          iterations += 1
          const result = await this.runGraph(target, trigger.id, current, { settings, depth: depth + 1 })
          if (result.status === 'error') throw new Error(result.errorMessage || 'Loop body failed.')
          current = result.output
          if (evaluateCondition(stopCondition, current)) {
            done = true
            break
          }
        }
        const baseJson =
          current.json && typeof current.json === 'object' && !Array.isArray(current.json)
            ? { ...(current.json as Record<string, unknown>) }
            : { value: current.json }
        return {
          payload: { json: { ...baseJson, _iterations: iterations, _done: done }, text: current.text },
          message: `looped ${iterations}${done ? ' (done)' : ' (max)'}`
        }
      }
      case 'merge': {
        if (node.config.mode === 'object') {
          const merged: Record<string, unknown> = {}
          for (const input of inputs) {
            if (input.json && typeof input.json === 'object' && !Array.isArray(input.json)) {
              Object.assign(merged, input.json as Record<string, unknown>)
            }
          }
          return { payload: { json: merged, text: safeJson(merged) }, message: `merged ${inputs.length}` }
        }
        const collected = inputs.map((input) => input.json)
        return {
          payload: { json: collected, text: inputs.map((input) => input.text).filter(Boolean).join('\n') },
          message: `merged ${inputs.length}`
        }
      }
      case 'set-fields': {
        const base =
          node.config.keepIncoming && payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
            ? { ...(payload.json as Record<string, unknown>) }
            : {}
        for (const field of node.config.fields) {
          if (field.key.trim()) base[field.key.trim()] = interpolate(field.value, payload)
        }
        const json = base
        return { payload: { json, text: safeJson(json) }, message: `${node.config.fields.length} fields` }
      }
      case 'filter': {
        const pass = evaluateCondition(node.config, payload)
        return { payload, message: pass ? 'pass' : 'blocked', branch: pass ? undefined : NO_BRANCH }
      }
      case 'sort': {
        const items = Array.isArray(payload.json) ? [...(payload.json as unknown[])] : []
        const { field, order, numeric } = node.config
        items.sort((a, b) => {
          const av = field ? getByPath(a, field) : a
          const bv = field ? getByPath(b, field) : b
          const cmp = numeric
            ? (Number(av) || 0) - (Number(bv) || 0)
            : String(av ?? '').localeCompare(String(bv ?? ''))
          return order === 'desc' ? -cmp : cmp
        })
        return { payload: { json: items, text: safeJson(items) }, message: `sorted ${items.length}` }
      }
      case 'limit': {
        const items = Array.isArray(payload.json) ? (payload.json as unknown[]) : []
        const out = node.config.from === 'last' ? items.slice(-node.config.count) : items.slice(0, node.config.count)
        return { payload: { json: out, text: safeJson(out) }, message: `${out.length} items` }
      }
      case 'aggregate': {
        const items = Array.isArray(payload.json) ? (payload.json as unknown[]) : []
        const valueOf = (item: unknown): unknown => (node.config.field ? getByPath(item, node.config.field) : item)
        if (node.config.mode === 'sum') {
          const sum = items.reduce<number>((acc, item) => acc + (Number(valueOf(item)) || 0), 0)
          return { payload: { json: { sum }, text: safeJson({ sum }) }, message: `sum ${sum}` }
        }
        if (node.config.mode === 'join') {
          const text = items.map((item) => stringifyValue(valueOf(item))).join(node.config.separator || ', ')
          return { payload: { json: { text }, text }, message: `joined ${items.length}` }
        }
        if (node.config.mode === 'collect') {
          const values = items.map((item) => valueOf(item))
          return { payload: { json: { values }, text: safeJson({ values }) }, message: `collected ${values.length}` }
        }
        return { payload: { json: { count: items.length }, text: safeJson({ count: items.length }) }, message: `count ${items.length}` }
      }
      case 'http-request':
        return runHttpNode(node.config, payload)
      case 'delay':
        await sleep(node.config.delayMs)
        return { payload, message: `Waited ${node.config.delayMs}ms` }
      default:
        return { payload, message: '' }
    }
  }

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const shouldKeepAwake =
      settings.workflow.keepAwake && settings.workflow.enabled && hasEnabledScheduledWorkflow(settings)
    if (!shouldKeepAwake) {
      // Only release if the schedule runtime is not also keeping the app awake.
      if (!(settings.schedule.keepAwake && settings.schedule.enabled && hasEnabledScheduledTask(settings))) {
        this.stopPowerSaveBlocker()
      }
      return
    }
    if (this.isPowerSaveBlockerActive()) return
    const blocker = this.deps.powerSaveBlocker
    if (!blocker) return
    this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('workflow-power-save', 'Failed to stop power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private isPowerSaveBlockerActive(): boolean {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    if (!blocker || id == null) return false
    try {
      return blocker.isStarted(id)
    } catch {
      return false
    }
  }
}

export function createWorkflowRuntime(deps: ScheduleRuntimeDeps): WorkflowRuntime {
  return new WorkflowRuntime(deps)
}
