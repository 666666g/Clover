import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import { extensionError } from './errors.js'
import { ExtensionPackageManager } from './package-manager.js'
import { assertExtensionId } from './paths.js'
import { createSafeNetworkFetch } from './safe-network-fetch.js'
import { EXTENSION_INDEX_SCHEMA_VERSION, type ExtensionIndexDocument } from './types.js'

const IndexVersionSchema = z.object({
  version: z.string(),
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  engines: z.object({ kun: z.string() }).strict(),
  apiVersion: z.string(),
  permissions: z.array(z.string()).max(500),
  signature: z.strictObject({
    algorithm: z.literal('ed25519'),
    keyId: z.string().min(1).max(256),
    value: z.string().min(1).max(16_384)
  }).optional()
}).strict()

const IndexSchema = z.object({
  schemaVersion: z.literal(EXTENSION_INDEX_SCHEMA_VERSION),
  extensions: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(4_000).optional(),
    publisher: z.string(),
    versions: z.array(IndexVersionSchema).max(10_000)
  }).strict()).max(100_000)
}).strict()

export type ExtensionIndexClientOptions = {
  fetch?: typeof fetch
  maxIndexBytes?: number
  maxPackageBytes?: number
  maxRedirects?: number
}

export class ExtensionIndexClient {
  private readonly fetchImpl: typeof fetch
  private readonly maxIndexBytes: number
  private readonly maxPackageBytes: number
  private readonly maxRedirects: number

  constructor(options: ExtensionIndexClientOptions = {}) {
    this.fetchImpl = options.fetch ?? createSafeNetworkFetch()
    this.maxIndexBytes = options.maxIndexBytes ?? 5 * 1024 * 1024
    this.maxPackageBytes = options.maxPackageBytes ?? 100 * 1024 * 1024
    this.maxRedirects = Math.max(0, Math.floor(options.maxRedirects ?? 5))
  }

  async load(indexUrl: string): Promise<ExtensionIndexDocument> {
    assertHttps(indexUrl, 'index')
    const response = await this.fetchHttps(indexUrl, 'index', {
      method: 'GET',
      headers: { accept: 'application/json' }
    })
    if (!response.ok) {
      throw extensionError('EXTENSION_INDEX_HTTP_ERROR', 'Extension index request failed', {
        indexUrl,
        status: response.status
      })
    }
    const contentLength = parseContentLength(response.headers.get('content-length'))
    enforceDownloadLimit(contentLength, this.maxIndexBytes, 'index')
    const bytes = await readResponseBounded(response, this.maxIndexBytes, 'index')
    let raw: unknown
    try {
      raw = JSON.parse(bytes.toString('utf8')) as unknown
    } catch (error) {
      throw extensionError('EXTENSION_INDEX_INVALID', 'Extension index is not valid JSON', {
        indexUrl
      }, error)
    }
    const parsed = IndexSchema.safeParse(raw)
    if (!parsed.success) {
      throw extensionError('EXTENSION_INDEX_INVALID', 'Extension index does not match Index v1', {
        indexUrl,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      })
    }
    validateIndexSemantics(parsed.data)
    return parsed.data
  }

  async installExact(
    indexUrl: string,
    extensionId: string,
    version: string,
    manager: ExtensionPackageManager,
    options: { grantedPermissions: string[]; enable?: boolean; select?: boolean }
  ) {
    const index = await this.load(indexUrl)
    const extension = index.extensions.find((candidate) => candidate.id === extensionId)
    const selected = extension?.versions.find((candidate) => candidate.version === version)
    if (extension === undefined || selected === undefined) {
      throw extensionError('EXTENSION_INDEX_VERSION_NOT_FOUND', 'Exact extension version is not in the index', {
        extensionId,
        version
      })
    }
    assertHttps(selected.url, 'package')
    await mkdir(manager.paths.downloadsRoot, { recursive: true, mode: 0o700 })
    const downloadPath = join(manager.paths.downloadsRoot, `${randomUUID()}.kunx`)
    try {
      const response = await this.fetchHttps(selected.url, 'package', {
        method: 'GET',
        headers: { accept: 'application/octet-stream, application/zip' }
      })
      if (!response.ok) {
        throw extensionError('EXTENSION_INDEX_PACKAGE_HTTP_ERROR', 'Extension package request failed', {
          extensionId,
          version,
          status: response.status
        })
      }
      const contentLength = parseContentLength(response.headers.get('content-length'))
      enforceDownloadLimit(contentLength, this.maxPackageBytes, 'package')
      const bytes = await readResponseBounded(response, this.maxPackageBytes, 'package')
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== selected.sha256) {
        throw extensionError('EXTENSION_INDEX_DIGEST_MISMATCH', 'Downloaded package digest differs from index', {
          extensionId,
          version,
          expected: selected.sha256,
          actual: digest
        })
      }
      await writeFile(downloadPath, bytes, { flag: 'wx', mode: 0o600 })
      return await manager.installArchive(downloadPath, {
        source: { type: 'index', locator: selected.url, indexUrl },
        grantedPermissions: options.grantedPermissions,
        enable: options.enable,
        select: options.select,
        expected: {
          extensionId,
          version,
          archiveSha256: selected.sha256,
          enginesKun: selected.engines.kun,
          apiVersion: selected.apiVersion,
          permissions: selected.permissions,
          signature: selected.signature
        }
      })
    } finally {
      await rm(downloadPath, { force: true }).catch(() => undefined)
    }
  }

  private async fetchHttps(
    requestedUrl: string,
    kind: string,
    init: RequestInit
  ): Promise<Response> {
    let currentUrl = requestedUrl
    for (let redirects = 0; ; redirects += 1) {
      assertHttps(currentUrl, kind)
      const response = await this.fetchImpl(currentUrl, { ...init, redirect: 'manual' })
      assertHttpsResponse(response.url, currentUrl, kind)
      if (!isRedirect(response.status)) return response
      if (redirects >= this.maxRedirects) {
        void response.body?.cancel().catch(() => undefined)
        throw extensionError('EXTENSION_INDEX_REDIRECT_LIMIT', `Extension ${kind} redirect limit exceeded`, {
          kind,
          maximum: this.maxRedirects
        })
      }
      const location = response.headers.get('location')
      if (!location) {
        void response.body?.cancel().catch(() => undefined)
        throw extensionError('EXTENSION_INDEX_REDIRECT_INVALID', `Extension ${kind} redirect has no location`, {
          kind,
          status: response.status
        })
      }
      const nextUrl = new URL(location, currentUrl).toString()
      assertHttps(nextUrl, kind)
      void response.body?.cancel().catch(() => undefined)
      currentUrl = nextUrl
    }
  }
}

function validateIndexSemantics(index: ExtensionIndexDocument): void {
  const identities = new Set<string>()
  for (const extension of index.extensions) {
    assertExtensionId(extension.id)
    if (extension.id.split('.')[0] !== extension.publisher) {
      throw extensionError('EXTENSION_INDEX_INVALID', 'Index publisher does not match extension ID', {
        extensionId: extension.id,
        publisher: extension.publisher
      })
    }
    if (identities.has(extension.id)) {
      throw extensionError('EXTENSION_INDEX_DUPLICATE_ID', 'Index contains a duplicate extension ID', {
        extensionId: extension.id
      })
    }
    identities.add(extension.id)
    const versions = new Set<string>()
    for (const version of extension.versions) {
      assertHttps(version.url, 'package')
      if (!semver.valid(version.version)) {
        throw extensionError('EXTENSION_INDEX_INVALID', 'Index version must be valid SemVer', {
          extensionId: extension.id,
          version: version.version
        })
      }
      if (!semver.valid(version.apiVersion) || semver.validRange(version.engines.kun) === null) {
        throw extensionError('EXTENSION_INDEX_INVALID', 'Index compatibility metadata is invalid', {
          extensionId: extension.id,
          version: version.version
        })
      }
      if (versions.has(version.version)) {
        throw extensionError('EXTENSION_INDEX_DUPLICATE_VERSION', 'Index contains a duplicate version', {
          extensionId: extension.id,
          version: version.version
        })
      }
      versions.add(version.version)
      if (new Set(version.permissions).size !== version.permissions.length) {
        throw extensionError('EXTENSION_INDEX_INVALID', 'Index permissions must be unique', {
          extensionId: extension.id,
          version: version.version
        })
      }
    }
  }
}

function assertHttps(value: string, kind: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw extensionError('EXTENSION_INDEX_URL_INVALID', `Extension ${kind} URL is invalid`, {
      url: value
    }, error)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw extensionError('EXTENSION_INDEX_HTTPS_REQUIRED', `Extension ${kind} URL must use HTTPS`, {
      url: value
    })
  }
}

function assertHttpsResponse(responseUrl: string, requestedUrl: string, kind: string): void {
  if (responseUrl !== '') assertHttps(responseUrl, kind)
  else assertHttps(requestedUrl, kind)
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function parseContentLength(value: string | null): number {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function enforceDownloadLimit(value: number, maximum: number, kind: string): void {
  if (value <= maximum) return
  throw extensionError('EXTENSION_INDEX_DOWNLOAD_LIMIT', `Extension ${kind} exceeds download limit`, {
    kind,
    value,
    maximum
  })
}

async function readResponseBounded(
  response: Response,
  maximum: number,
  kind: string
): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    enforceDownloadLimit(bytes, maximum, kind)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, bytes)
}
