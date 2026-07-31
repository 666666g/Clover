import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import { z } from 'zod'
import { extensionError } from './errors.js'
import {
  assertCanonicalPackagePath,
  defaultManifestAdapter,
  manifestLocalResourceRoots,
  manifestReferencedFiles,
  manifestId,
  type ManifestAdapter
} from './manifest.js'
import type {
  ExtensionCompatibility,
  ExtensionIntegrityManifest,
  ExtensionManifest,
  ExtensionSignatureStatus
} from './types.js'

export const EXTENSION_MANIFEST_FILE = 'kun-extension.json'
export const EXTENSION_INTEGRITY_FILE = 'kun-extension.integrity.json'
export const EXTENSION_README_FILE = 'README.md'
export const EXTENSION_LICENSE_FILE = 'LICENSE'

const REQUIRED_PACKAGE_FILES = [
  EXTENSION_MANIFEST_FILE,
  EXTENSION_README_FILE,
  EXTENSION_LICENSE_FILE
] as const

export type ExtensionArchiveLimits = {
  maxArchiveBytes: number
  maxExpandedBytes: number
  maxFileBytes: number
  maxFiles: number
  maxManifestBytes: number
}

export const DEFAULT_EXTENSION_ARCHIVE_LIMITS: Readonly<ExtensionArchiveLimits> = Object.freeze({
  maxArchiveBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 250 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 5_000,
  maxManifestBytes: 1024 * 1024
})

export type ExtractedKunx = {
  archivePath: string
  destination: string
  archiveSha256: string
  manifest: ExtensionManifest
  integrity: ExtensionIntegrityManifest
  signatureStatus: ExtensionSignatureStatus
  fileCount: number
  expandedBytes: number
}

export type ArchiveValidationOptions = {
  limits?: Partial<ExtensionArchiveLimits>
  compatibility?: ExtensionCompatibility
  manifestAdapter?: ManifestAdapter
}

const IntegritySchema = z.object({
  algorithm: z.literal('sha256'),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
}).strict()

export async function extractKunxArchive(
  archivePath: string,
  destination: string,
  options: ArchiveValidationOptions = {}
): Promise<ExtractedKunx> {
  const limits = archiveLimits(options.limits)
  const adapter = options.manifestAdapter ?? defaultManifestAdapter
  const archiveStats = await stat(archivePath)
  if (!archiveStats.isFile()) {
    throw extensionError('EXTENSION_ARCHIVE_NOT_FILE', 'Extension archive must be a regular file', {
      archivePath
    })
  }
  enforceLimit('archiveBytes', archiveStats.size, limits.maxArchiveBytes)
  await ensureEmptyDirectory(destination)

  const archiveSha256 = await sha256File(archivePath)
  const actualDigests = new Map<string, string>()
  const extractedPaths = new Set<string>()
  const archivePaths = new Map<string, string>()
  const pathKinds = new Map<string, 'file' | 'directory'>()
  let expandedBytes = 0
  let fileCount = 0
  let zipfile: yauzl.ZipFile | undefined

  try {
    zipfile = await yauzl.openPromise(archivePath, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
      autoClose: false
    })
    enforceLimit('files', zipfile.entryCount, limits.maxFiles)

    for await (const entry of zipfile.eachEntry()) {
      const directory = entry.fileName.endsWith('/')
      const canonicalPath = validateArchiveEntry(entry, directory)
      registerArchivePath(canonicalPath, directory, archivePaths, pathKinds)
      if (directory) {
        await mkdir(join(destination, ...canonicalPath.split('/')), {
          recursive: true,
          mode: 0o700
        })
        continue
      }

      fileCount += 1
      enforceLimit('files', fileCount, limits.maxFiles)
      enforceLimit('fileBytes', entry.uncompressedSize, limits.maxFileBytes, canonicalPath)
      expandedBytes += entry.uncompressedSize
      enforceLimit('expandedBytes', expandedBytes, limits.maxExpandedBytes)

      const target = safeDestination(destination, canonicalPath)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await assertNoLinkParents(destination, dirname(target))
      const input = await zipfile.openReadStreamPromise(entry)
      const output = createWriteStream(target, { flags: 'wx', mode: 0o600 })
      const digest = createHash('sha256')
      let streamedBytes = 0
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          streamedBytes += chunk.length
          if (streamedBytes > limits.maxFileBytes) {
            callback(
              extensionError('EXTENSION_ARCHIVE_LIMIT_EXCEEDED', 'Expanded file exceeds limit', {
                limit: 'fileBytes',
                path: canonicalPath,
                maximum: limits.maxFileBytes
              })
            )
            return
          }
          digest.update(chunk)
          callback(null, chunk)
        }
      })
      await pipeline(input, limiter, output)
      if (streamedBytes !== entry.uncompressedSize) {
        throw extensionError('EXTENSION_ARCHIVE_SIZE_MISMATCH', 'Archive entry size changed while extracting', {
          path: canonicalPath,
          declared: entry.uncompressedSize,
          actual: streamedBytes
        })
      }
      extractedPaths.add(canonicalPath)
      actualDigests.set(canonicalPath, digest.digest('hex'))
    }

    for (const required of [...REQUIRED_PACKAGE_FILES, EXTENSION_INTEGRITY_FILE]) {
      if (!extractedPaths.has(required)) {
        throw extensionError('EXTENSION_PACKAGE_FILE_MISSING', 'Required package file is missing', {
          path: required
        })
      }
    }

    const manifest = adapter.parse(
      await readBoundedJson(join(destination, EXTENSION_MANIFEST_FILE), limits.maxManifestBytes)
    )
    if (options.compatibility !== undefined) {
      adapter.assertCompatible(manifest, options.compatibility)
    }
    const integrity = parseIntegrity(
      await readBoundedJson(join(destination, EXTENSION_INTEGRITY_FILE), limits.maxManifestBytes)
    )
    await validateExtractedPackage(destination, manifest, integrity, extractedPaths, actualDigests)

    return {
      archivePath: resolve(archivePath),
      destination: resolve(destination),
      archiveSha256,
      manifest,
      integrity,
      signatureStatus: manifest.signature === undefined ? 'unsigned' : 'present-unverified',
      fileCount,
      expandedBytes
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined)
    if (error instanceof Error && error.name === 'ExtensionError') throw error
    throw extensionError('EXTENSION_ARCHIVE_INVALID', 'Extension archive validation failed', {
      archivePath
    }, error)
  } finally {
    zipfile?.close()
  }
}

export async function inspectKunxArchive(
  archivePath: string,
  options: ArchiveValidationOptions = {}
): Promise<Omit<ExtractedKunx, 'destination'>> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-extension-inspect-'))
  const destination = join(temporaryRoot, 'package')
  try {
    const { destination: _destination, ...inspection } = await extractKunxArchive(
      archivePath,
      destination,
      options
    )
    return inspection
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export type PackKunxOptions = ArchiveValidationOptions & {
  overwrite?: boolean
  /** Additional package-relative files or directories to include. Directories are recursive. */
  include?: readonly string[]
  /** Package-relative files or directory trees to exclude from the selected release files. */
  ignore?: readonly string[]
}

export async function packKunx(
  sourceDirectory: string,
  outputPath: string,
  options: PackKunxOptions = {}
): Promise<Omit<ExtractedKunx, 'destination'>> {
  const limits = archiveLimits(options.limits)
  const sourceRoot = resolve(sourceDirectory)
  const output = resolve(outputPath)
  const sourceStats = await lstat(sourceRoot)
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw extensionError('EXTENSION_PACKAGE_SOURCE_INVALID', 'Package source must be a real directory', {
      sourceDirectory
    })
  }
  if (!options.overwrite) {
    try {
      await lstat(output)
      throw extensionError('EXTENSION_PACKAGE_OUTPUT_EXISTS', 'Package output already exists', {
        outputPath: output
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }
  }

  const adapter = options.manifestAdapter ?? defaultManifestAdapter
  const manifestPath = join(sourceRoot, EXTENSION_MANIFEST_FILE)
  await assertNoSourceLinkParents(sourceRoot, manifestPath)
  const manifestStats = await lstat(manifestPath).catch((error: unknown) => {
    throw extensionError(
      'EXTENSION_PACKAGE_FILE_MISSING',
      'Required package file is missing',
      { path: EXTENSION_MANIFEST_FILE },
      error
    )
  })
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw extensionError(
      manifestStats.isSymbolicLink()
        ? 'EXTENSION_PACKAGE_LINK_FORBIDDEN'
        : 'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
      'Extension manifest must be a regular file inside the package source',
      { path: EXTENSION_MANIFEST_FILE }
    )
  }
  const manifest = adapter.parse(
    await readBoundedJson(manifestPath, limits.maxManifestBytes)
  )
  if (options.compatibility !== undefined) adapter.assertCompatible(manifest, options.compatibility)

  const files = await collectPackFiles(sourceRoot, output, manifest, limits, options)
  const filePaths = new Set(files.map((file) => file.path))
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!filePaths.has(required)) {
      throw extensionError('EXTENSION_PACKAGE_FILE_MISSING', 'Required package file is missing', {
        path: required
      })
    }
  }
  assertManifestReferencedFiles(manifest, filePaths)
  await assertResourceRoots(sourceRoot, manifest)

  const integrityFiles: Record<string, string> = {}
  for (const file of files) integrityFiles[file.path] = await sha256File(file.absolutePath)
  const integrity: ExtensionIntegrityManifest = { algorithm: 'sha256', files: integrityFiles }
  const integrityContents = Buffer.from(`${JSON.stringify(integrity, null, 2)}\n`, 'utf8')
  enforceLimit('fileBytes', integrityContents.length, limits.maxFileBytes, EXTENSION_INTEGRITY_FILE)

  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const temporaryOutput = `${output}.${process.pid}.${randomUUID()}.tmp`
  const zipfile = new yazl.ZipFile()
  const fixedTime = new Date('1980-01-01T00:00:00.000Z')
  for (const file of files) {
    zipfile.addFile(file.absolutePath, file.path, {
      mtime: fixedTime,
      mode: 0o100644,
      compress: true
    })
  }
  zipfile.addBuffer(integrityContents, EXTENSION_INTEGRITY_FILE, {
    mtime: fixedTime,
    mode: 0o100644,
    compress: true
  })

  try {
    const outputStream = createWriteStream(temporaryOutput, { flags: 'wx', mode: 0o600 })
    zipfile.end()
    await pipeline(zipfile.outputStream, outputStream)
    enforceLimit('archiveBytes', (await stat(temporaryOutput)).size, limits.maxArchiveBytes)
    const inspection = await inspectKunxArchive(temporaryOutput, options)
    await rename(temporaryOutput, output)
    return { ...inspection, archivePath: output }
  } catch (error) {
    await rm(temporaryOutput, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function verifyExtractedExtension(
  packageRoot: string,
  manifest: ExtensionManifest,
  integrity: ExtensionIntegrityManifest,
  limits: Partial<ExtensionArchiveLimits> = {}
): Promise<void> {
  const resolvedLimits = archiveLimits(limits)
  const actualFiles = await collectPackageFiles(resolve(packageRoot), '', resolvedLimits)
  const actualPaths = new Set(actualFiles.map((file) => file.path))
  actualPaths.add(EXTENSION_INTEGRITY_FILE)
  const expectedPaths = new Set(Object.keys(integrity.files))
  expectedPaths.add(EXTENSION_INTEGRITY_FILE)
  if (!setEquals(actualPaths, expectedPaths)) {
    throw extensionError('EXTENSION_PACKAGE_INTEGRITY_MISMATCH', 'Installed package file set changed', {
      extensionId: manifestId(manifest)
    })
  }
  for (const file of actualFiles) {
    const expected = integrity.files[file.path]
    const actual = await sha256File(file.absolutePath)
    if (expected !== actual) {
      throw extensionError('EXTENSION_PACKAGE_INTEGRITY_MISMATCH', 'Installed package file digest changed', {
        extensionId: manifestId(manifest),
        path: file.path
      })
    }
  }
  assertManifestReferencedFiles(manifest, new Set(actualFiles.map((file) => file.path)))
  await assertResourceRoots(resolve(packageRoot), manifest)
}

export type InspectedDevelopmentExtension = {
  path: string
  manifest: ExtensionManifest
  digest: string
}

export async function inspectDevelopmentDirectory(
  sourceDirectory: string,
  options: ArchiveValidationOptions = {}
): Promise<InspectedDevelopmentExtension> {
  const limits = archiveLimits(options.limits)
  const sourceRoot = resolve(sourceDirectory)
  const rootDetails = await lstat(sourceRoot)
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw extensionError(
      'EXTENSION_DEVELOPMENT_SOURCE_INVALID',
      'Development source must be a real directory',
      { sourceDirectory }
    )
  }
  const manifestPath = join(sourceRoot, EXTENSION_MANIFEST_FILE)
  await assertNoSourceLinkParents(sourceRoot, manifestPath)
  const manifestDetails = await lstat(manifestPath).catch((error: unknown) => {
    throw extensionError(
      'EXTENSION_PACKAGE_FILE_MISSING',
      'Development manifest is missing',
      { path: EXTENSION_MANIFEST_FILE },
      error
    )
  })
  if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink()) {
    throw extensionError(
      manifestDetails.isSymbolicLink()
        ? 'EXTENSION_PACKAGE_LINK_FORBIDDEN'
        : 'EXTENSION_DEVELOPMENT_FILE_INVALID',
      'Development manifest must be a regular file inside the source directory',
      { path: EXTENSION_MANIFEST_FILE }
    )
  }
  const manifest = (options.manifestAdapter ?? defaultManifestAdapter).parse(
    await readBoundedJson(manifestPath, limits.maxManifestBytes)
  )
  if (options.compatibility !== undefined) {
    ;(options.manifestAdapter ?? defaultManifestAdapter).assertCompatible(
      manifest,
      options.compatibility
    )
  }

  const digest = createHash('sha256')
  const hashedFiles = new Set<string>()
  const portablePaths = new Map<string, string>()
  let hashedBytes = 0
  let hashedFileCount = 0
  const hashFile = async (absolutePath: string): Promise<void> => {
    await assertNoSourceLinkParents(sourceRoot, absolutePath)
    const packagePath = relative(sourceRoot, absolutePath).split(sep).join('/')
    if (hashedFiles.has(packagePath)) return
    assertCanonicalPackagePath(packagePath, false)
    const portableKey = portablePathKey(packagePath)
    const prior = portablePaths.get(portableKey)
    if (prior !== undefined && prior !== packagePath) {
      throw extensionError(
        'EXTENSION_PACKAGE_PATH_COLLISION',
        'Development source paths collide portably',
        { first: prior, second: packagePath }
      )
    }
    portablePaths.set(portableKey, packagePath)
    const details = await lstat(absolutePath)
    if (!details.isFile() || details.isSymbolicLink()) {
      throw extensionError(
        'EXTENSION_DEVELOPMENT_FILE_INVALID',
        'Development resource must be a regular file',
        { path: packagePath }
      )
    }
    enforceLimit('fileBytes', details.size, limits.maxFileBytes, packagePath)
    hashedBytes += details.size
    hashedFileCount += 1
    enforceLimit('expandedBytes', hashedBytes, limits.maxExpandedBytes)
    enforceLimit('files', hashedFileCount, limits.maxFiles)
    hashedFiles.add(packagePath)
    digest.update(packagePath)
    digest.update(await readFile(absolutePath))
  }
  await hashFile(manifestPath)
  for (const entrypoint of manifestReferencedFiles(manifest)) {
    const entrypointPath = safeDestination(sourceRoot, entrypoint)
    await assertNoSourceLinkParents(sourceRoot, entrypointPath)
    const details = await lstat(entrypointPath).catch((error: unknown) => {
      throw extensionError('EXTENSION_ENTRYPOINT_MISSING', 'Development entrypoint is missing', {
        path: entrypoint
      }, error)
    })
    if (!details.isFile() || details.isSymbolicLink()) {
      throw extensionError(
        'EXTENSION_ENTRYPOINT_INVALID',
        'Development referenced file must be a regular file',
        { path: entrypoint }
      )
    }
    await hashFile(entrypointPath)
  }
  for (const resourceRoot of manifestLocalResourceRoots(manifest)) {
    const resourcePath = safeDestination(sourceRoot, resourceRoot)
    await assertNoSourceLinkParents(sourceRoot, resourcePath)
    const details = await lstat(resourcePath).catch((error: unknown) => {
      throw extensionError(
        'EXTENSION_RESOURCE_ROOT_INVALID',
        'Development resource root is missing',
        { root: resourceRoot },
        error
      )
    })
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw extensionError(
        'EXTENSION_RESOURCE_ROOT_INVALID',
        'Development resource root must be a real directory',
        { root: resourceRoot }
      )
    }
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
      for (const entry of entries) {
        const path = join(directory, entry.name)
        const entryDetails = await lstat(path)
        if (entryDetails.isSymbolicLink()) {
          throw extensionError(
            'EXTENSION_PACKAGE_LINK_FORBIDDEN',
            'Development resource roots cannot contain links',
            { path: relative(sourceRoot, path) }
          )
        }
        if (entryDetails.isDirectory()) await visit(path)
        else if (entryDetails.isFile()) await hashFile(path)
        else {
          throw extensionError(
            'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
            'Development resource root contains a special file',
            { path: relative(sourceRoot, path) }
          )
        }
      }
    }
    await visit(resourcePath)
  }
  return { path: sourceRoot, manifest, digest: digest.digest('hex') }
}

export async function makePackageTreeReadOnly(packageRoot: string): Promise<void> {
  if (process.platform === 'win32') return
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        await chmod(path, 0o555)
      } else if (entry.isFile()) {
        await chmod(path, 0o444)
      }
    }
  }
  await visit(packageRoot)
  await chmod(packageRoot, 0o555)
}

function validateArchiveEntry(entry: yauzl.Entry, directory: boolean): string {
  if (entry.isEncrypted()) {
    throw extensionError('EXTENSION_ARCHIVE_ENCRYPTED', 'Encrypted archive entries are not supported', {
      path: entry.fileName
    })
  }
  if (!entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) {
    throw extensionError('EXTENSION_ARCHIVE_COMPRESSION_UNSUPPORTED', 'Unsupported archive compression', {
      path: entry.fileName,
      compressionMethod: entry.compressionMethod
    })
  }
  const canonicalPath = assertCanonicalPackagePath(entry.fileName, directory)
  const platform = entry.versionMadeBy >>> 8
  if (platform === 3) {
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
    const fileType = unixMode & 0o170000
    if (fileType === 0o120000) {
      throw extensionError('EXTENSION_ARCHIVE_LINK_FORBIDDEN', 'Symbolic links are forbidden in extensions', {
        path: canonicalPath
      })
    }
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
      throw extensionError('EXTENSION_ARCHIVE_LINK_FORBIDDEN', 'Non-regular archive entries are forbidden', {
        path: canonicalPath,
        fileType
      })
    }
    if (directory && fileType === 0o100000) {
      throw extensionError('EXTENSION_ARCHIVE_TYPE_MISMATCH', 'Archive directory has file attributes', {
        path: canonicalPath
      })
    }
    if (!directory && fileType === 0o040000) {
      throw extensionError('EXTENSION_ARCHIVE_TYPE_MISMATCH', 'Archive file has directory attributes', {
        path: canonicalPath
      })
    }
  }
  return canonicalPath
}

function registerArchivePath(
  path: string,
  directory: boolean,
  archivePaths: Map<string, string>,
  pathKinds: Map<string, 'file' | 'directory'>
): void {
  const folded = portablePathKey(path)
  const prior = archivePaths.get(folded)
  if (prior !== undefined) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_COLLISION', 'Archive paths collide after normalization', {
      first: prior,
      second: path
    })
  }
  archivePaths.set(folded, path)

  const parts = path.split('/')
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = portablePathKey(parts.slice(0, index).join('/'))
    if (pathKinds.get(ancestor) === 'file') {
      throw extensionError('EXTENSION_ARCHIVE_PATH_COLLISION', 'Archive file is used as a directory', {
        path
      })
    }
    pathKinds.set(ancestor, 'directory')
  }
  const existingKind = pathKinds.get(folded)
  const nextKind = directory ? 'directory' : 'file'
  if (existingKind !== undefined && existingKind !== nextKind) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_COLLISION', 'Archive path type is ambiguous', { path })
  }
  pathKinds.set(folded, nextKind)
}

async function validateExtractedPackage(
  destination: string,
  manifest: ExtensionManifest,
  integrity: ExtensionIntegrityManifest,
  extractedPaths: Set<string>,
  actualDigests: Map<string, string>
): Promise<void> {
  for (const required of [...REQUIRED_PACKAGE_FILES, EXTENSION_INTEGRITY_FILE]) {
    if (!extractedPaths.has(required)) {
      throw extensionError('EXTENSION_PACKAGE_FILE_MISSING', 'Required package file is missing', {
        path: required
      })
    }
  }
  if (integrity.files[EXTENSION_INTEGRITY_FILE] !== undefined) {
    throw extensionError(
      'EXTENSION_INTEGRITY_INVALID',
      'Integrity manifest must not contain a digest for itself'
    )
  }
  const actualPackageFiles = new Set(extractedPaths)
  actualPackageFiles.delete(EXTENSION_INTEGRITY_FILE)
  const declaredFiles = new Set(Object.keys(integrity.files))
  if (!setEquals(actualPackageFiles, declaredFiles)) {
    throw extensionError('EXTENSION_PACKAGE_FILE_SET_MISMATCH', 'Package and integrity file sets differ', {
      undeclared: [...actualPackageFiles].filter((path) => !declaredFiles.has(path)),
      missing: [...declaredFiles].filter((path) => !actualPackageFiles.has(path))
    })
  }
  for (const [path, expected] of Object.entries(integrity.files)) {
    assertCanonicalPackagePath(path, false)
    const actual = actualDigests.get(path)
    if (actual !== expected) {
      throw extensionError('EXTENSION_PACKAGE_INTEGRITY_MISMATCH', 'Package file digest mismatch', {
        path,
        expected,
        actual
      })
    }
  }
  assertManifestReferencedFiles(manifest, actualPackageFiles)
  await assertResourceRoots(destination, manifest)
}

function assertManifestReferencedFiles(manifest: ExtensionManifest, files: Set<string>): void {
  for (const path of manifestReferencedFiles(manifest)) {
    if (!files.has(path)) {
      throw extensionError('EXTENSION_ENTRYPOINT_MISSING', 'Manifest referenced file is missing', {
        path
      })
    }
  }
}

async function assertResourceRoots(packageRoot: string, manifest: ExtensionManifest): Promise<void> {
  for (const root of manifestLocalResourceRoots(manifest)) {
    const resourcePath = safeDestination(packageRoot, root)
    const details = await lstat(resourcePath).catch((error: unknown) => {
      throw extensionError('EXTENSION_RESOURCE_ROOT_INVALID', 'Local resource root is missing', {
        root
      }, error)
    })
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw extensionError('EXTENSION_RESOURCE_ROOT_INVALID', 'Local resource root must be a directory', {
        root
      })
    }
  }
}

function parseIntegrity(value: unknown): ExtensionIntegrityManifest {
  const parsed = IntegritySchema.safeParse(value)
  if (!parsed.success) {
    throw extensionError('EXTENSION_INTEGRITY_INVALID', 'Package integrity manifest is invalid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }
  return parsed.data
}

async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  const details = await stat(path)
  enforceLimit('manifestBytes', details.size, maxBytes, path)
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw extensionError('EXTENSION_PACKAGE_JSON_INVALID', 'Package JSON file is invalid', { path }, error)
  }
}

async function ensureEmptyDirectory(destination: string): Promise<void> {
  try {
    const details = await lstat(destination)
    if (!details.isDirectory()) {
      throw extensionError('EXTENSION_STAGING_INVALID', 'Staging destination must be a directory', {
        destination
      })
    }
    if ((await readdir(destination)).length !== 0) {
      throw extensionError('EXTENSION_STAGING_NOT_EMPTY', 'Staging destination must be empty', {
        destination
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    await mkdir(destination, { recursive: true, mode: 0o700 })
  }
}

function safeDestination(root: string, canonicalPath: string): string {
  const target = resolve(root, ...canonicalPath.split('/'))
  const resolvedRoot = resolve(root)
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_INVALID', 'Archive path escapes staging root', {
      path: canonicalPath
    })
  }
  return target
}

async function assertNoLinkParents(root: string, parent: string): Promise<void> {
  const resolvedRoot = resolve(root)
  const relativeParent = relative(resolvedRoot, resolve(parent))
  let current = resolvedRoot
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, part)
    const details = await lstat(current)
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw extensionError('EXTENSION_ARCHIVE_LINK_FORBIDDEN', 'Staging path contains a link', {
        path: current
      })
    }
  }
}

type PackageFile = { path: string; absolutePath: string; size: number }

const FORBIDDEN_PACKAGE_DIRECTORY_NAMES = new Set([
  '.aws',
  '.direnv',
  '.git',
  '.gnupg',
  '.hg',
  '.ssh',
  '.svn',
  'node_modules'
])

const FORBIDDEN_PACKAGE_FILE_NAMES = new Set([
  '.envrc',
  '.netrc',
  '.npmrc',
  '.yarnrc',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'private-key',
  'private_key',
  'secret',
  'secrets'
])

const FORBIDDEN_PACKAGE_FILE_EXTENSIONS = new Set([
  '.jks',
  '.key',
  '.keystore',
  '.kubeconfig',
  '.p12',
  '.pem',
  '.pfx'
])

async function collectPackFiles(
  sourceRoot: string,
  excludedOutput: string,
  manifest: ExtensionManifest,
  limits: ExtensionArchiveLimits,
  options: Pick<PackKunxOptions, 'include' | 'ignore'>
): Promise<PackageFile[]> {
  const files = new Map<string, PackageFile>()
  const ignored = (options.ignore ?? []).map((rule) => canonicalPackRule(rule, 'ignore'))
  let totalBytes = 0

  const isIgnored = (packagePath: string): boolean =>
    ignored.some((rule) => packagePath === rule || packagePath.startsWith(`${rule}/`))

  const addFile = async (packagePath: string, absolutePath: string): Promise<void> => {
    if (resolve(absolutePath) === excludedOutput || isIgnored(packagePath)) return
    const forbiddenReason = forbiddenPackagePathReason(packagePath)
    if (forbiddenReason !== undefined) {
      throw extensionError(
        'EXTENSION_PACKAGE_FORBIDDEN_PATH',
        'Selected release files contain a path that must not be packaged',
        { path: packagePath, reason: forbiddenReason }
      )
    }
    await assertNoSourceLinkParents(sourceRoot, absolutePath)
    const details = await lstat(absolutePath).catch((error: unknown) => {
      throw extensionError(
        'EXTENSION_PACKAGE_FILE_MISSING',
        'Selected package file is missing',
        { path: packagePath },
        error
      )
    })
    if (details.isSymbolicLink()) {
      throw extensionError('EXTENSION_PACKAGE_LINK_FORBIDDEN', 'Package source cannot contain links', {
        path: packagePath
      })
    }
    if (!details.isFile()) {
      throw extensionError(
        'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
        'Selected package path must be a regular file',
        { path: packagePath }
      )
    }
    if (files.has(packagePath)) return
    enforceLimit('fileBytes', details.size, limits.maxFileBytes, packagePath)
    totalBytes += details.size
    enforceLimit('expandedBytes', totalBytes, limits.maxExpandedBytes)
    files.set(packagePath, { path: packagePath, absolutePath, size: details.size })
    enforceLimit('files', files.size, limits.maxFiles)
  }

  const visitDirectory = async (packageRoot: string): Promise<void> => {
    if (isIgnored(packageRoot)) return
    const forbiddenReason = forbiddenPackagePathReason(packageRoot)
    if (forbiddenReason !== undefined) {
      throw extensionError(
        'EXTENSION_PACKAGE_FORBIDDEN_PATH',
        'Selected release directory must not be packaged',
        { path: packageRoot, reason: forbiddenReason }
      )
    }
    const absoluteRoot = safeDestination(sourceRoot, packageRoot)
    await assertNoSourceLinkParents(sourceRoot, absoluteRoot)
    const rootDetails = await lstat(absoluteRoot).catch((error: unknown) => {
      throw extensionError(
        'EXTENSION_PACKAGE_INCLUDE_MISSING',
        'Selected package directory is missing',
        { path: packageRoot },
        error
      )
    })
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
      throw extensionError(
        rootDetails.isSymbolicLink()
          ? 'EXTENSION_PACKAGE_LINK_FORBIDDEN'
          : 'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
        'Selected package directory must be a real directory',
        { path: packageRoot }
      )
    }

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
      for (const entry of entries) {
        const absolutePath = join(directory, entry.name)
        const packagePath = relative(sourceRoot, absolutePath).split(sep).join('/')
        assertCanonicalPackagePath(packagePath, entry.isDirectory())
        if (resolve(absolutePath) === excludedOutput || isIgnored(packagePath)) continue
        const entryForbiddenReason = forbiddenPackagePathReason(packagePath)
        if (entryForbiddenReason !== undefined) {
          throw extensionError(
            'EXTENSION_PACKAGE_FORBIDDEN_PATH',
            'Selected release files contain a path that must not be packaged',
            { path: packagePath, reason: entryForbiddenReason }
          )
        }
        const details = await lstat(absolutePath)
        if (details.isSymbolicLink()) {
          throw extensionError(
            'EXTENSION_PACKAGE_LINK_FORBIDDEN',
            'Package source cannot contain links',
            { path: packagePath }
          )
        }
        if (details.isDirectory()) await visit(absolutePath)
        else if (details.isFile()) await addFile(packagePath, absolutePath)
        else {
          throw extensionError(
            'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
            'Package source contains a special file',
            { path: packagePath }
          )
        }
      }
    }
    await visit(absoluteRoot)
  }

  const exactFiles = new Set<string>([
    ...REQUIRED_PACKAGE_FILES,
    ...manifestReferencedFiles(manifest)
  ])
  const recursiveRoots = new Set(manifestLocalResourceRoots(manifest))

  for (const rawRule of options.include ?? []) {
    const packagePath = canonicalPackRule(rawRule, 'include')
    const forbiddenReason = forbiddenPackagePathReason(packagePath)
    if (forbiddenReason !== undefined) {
      throw extensionError(
        'EXTENSION_PACKAGE_FORBIDDEN_PATH',
        'An include rule targets a path that must not be packaged',
        { path: packagePath, reason: forbiddenReason }
      )
    }
    const absolutePath = safeDestination(sourceRoot, packagePath)
    await assertNoSourceLinkParents(sourceRoot, absolutePath)
    const details = await lstat(absolutePath).catch((error: unknown) => {
      throw extensionError(
        'EXTENSION_PACKAGE_INCLUDE_MISSING',
        'Package include path is missing',
        { path: packagePath },
        error
      )
    })
    if (details.isSymbolicLink()) {
      throw extensionError('EXTENSION_PACKAGE_LINK_FORBIDDEN', 'Package include cannot be a link', {
        path: packagePath
      })
    }
    if (details.isDirectory()) recursiveRoots.add(packagePath)
    else if (details.isFile()) exactFiles.add(packagePath)
    else {
      throw extensionError(
        'EXTENSION_PACKAGE_FILE_TYPE_INVALID',
        'Package include must be a regular file or directory',
        { path: packagePath }
      )
    }
  }

  for (const packagePath of [...exactFiles].sort()) {
    await addFile(packagePath, safeDestination(sourceRoot, packagePath))
  }
  for (const packageRoot of [...recursiveRoots].sort()) await visitDirectory(packageRoot)

  const portablePaths = new Map<string, string>()
  for (const file of files.values()) {
    const key = portablePathKey(file.path)
    const existing = portablePaths.get(key)
    if (existing !== undefined && existing !== file.path) {
      throw extensionError('EXTENSION_PACKAGE_PATH_COLLISION', 'Package source paths collide portably', {
        first: existing,
        second: file.path
      })
    }
    portablePaths.set(key, file.path)
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function canonicalPackRule(value: string, kind: 'include' | 'ignore'): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed !== value) {
    throw extensionError(
      'EXTENSION_PACKAGE_RULE_INVALID',
      `Package ${kind} rule must not be empty or padded with whitespace`,
      { kind, rule: value }
    )
  }
  const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  try {
    return assertCanonicalPackagePath(withoutTrailingSlash, true)
  } catch (error) {
    throw extensionError(
      'EXTENSION_PACKAGE_RULE_INVALID',
      `Package ${kind} rule must be a canonical package-relative path`,
      { kind, rule: value },
      error
    )
  }
}

function forbiddenPackagePathReason(packagePath: string): string | undefined {
  const segments = packagePath.split('/').map((segment) => segment.toLocaleLowerCase('en-US'))
  const forbiddenDirectory = segments.find((segment) =>
    FORBIDDEN_PACKAGE_DIRECTORY_NAMES.has(segment)
  )
  if (forbiddenDirectory !== undefined) return `forbidden-directory:${forbiddenDirectory}`

  const fileName = segments.at(-1) ?? ''
  if (fileName === EXTENSION_INTEGRITY_FILE.toLocaleLowerCase('en-US')) {
    return 'generated-integrity-file'
  }
  if (fileName === '.env' || fileName.startsWith('.env.')) return 'dotenv-file'
  if (fileName.endsWith('.kunx')) return 'nested-package'
  if (FORBIDDEN_PACKAGE_FILE_NAMES.has(fileName)) return `sensitive-file:${fileName}`
  const extensionIndex = fileName.lastIndexOf('.')
  const extension = extensionIndex < 0 ? '' : fileName.slice(extensionIndex)
  if (FORBIDDEN_PACKAGE_FILE_EXTENSIONS.has(extension)) return `credential-file:${extension}`
  if (/^(?:credentials?|secrets?)\.(?:json|ya?ml|toml|ini)$/.test(fileName)) {
    return 'credential-config'
  }
  if (/^private[-_.]?key(?:\.[a-z0-9_-]+)?$/.test(fileName)) return 'private-key-file'
  return undefined
}

async function assertNoSourceLinkParents(sourceRoot: string, target: string): Promise<void> {
  const resolvedRoot = resolve(sourceRoot)
  const relativeTarget = relative(resolvedRoot, resolve(target))
  if (
    relativeTarget.length === 0 ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_INVALID', 'Package source path escapes source root', {
      path: relativeTarget
    })
  }
  let current = resolvedRoot
  for (const part of relativeTarget.split(sep).filter(Boolean)) {
    current = join(current, part)
    const details = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (details === undefined) return
    if (details.isSymbolicLink()) {
      throw extensionError('EXTENSION_PACKAGE_LINK_FORBIDDEN', 'Package source path contains a link', {
        path: relative(sourceRoot, current).split(sep).join('/')
      })
    }
  }
}

async function collectPackageFiles(
  sourceRoot: string,
  excludedOutput: string,
  limits: ExtensionArchiveLimits,
  includeIntegrity = false
): Promise<PackageFile[]> {
  const files: PackageFile[] = []
  let totalBytes = 0
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      if (resolve(absolutePath) === excludedOutput) continue
      const details = await lstat(absolutePath)
      if (details.isSymbolicLink()) {
        throw extensionError('EXTENSION_PACKAGE_LINK_FORBIDDEN', 'Package source cannot contain links', {
          path: relative(sourceRoot, absolutePath)
        })
      }
      if (details.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!details.isFile()) {
        throw extensionError('EXTENSION_PACKAGE_FILE_TYPE_INVALID', 'Package source contains a special file', {
          path: relative(sourceRoot, absolutePath)
        })
      }
      const packagePath = relative(sourceRoot, absolutePath).split(sep).join('/')
      assertCanonicalPackagePath(packagePath, false)
      if (!includeIntegrity && packagePath === EXTENSION_INTEGRITY_FILE) continue
      enforceLimit('fileBytes', details.size, limits.maxFileBytes, packagePath)
      totalBytes += details.size
      enforceLimit('expandedBytes', totalBytes, limits.maxExpandedBytes)
      files.push({ path: packagePath, absolutePath, size: details.size })
      enforceLimit('files', files.length, limits.maxFiles)
    }
  }
  await visit(sourceRoot)
  const portablePaths = new Map<string, string>()
  for (const file of files) {
    const key = portablePathKey(file.path)
    const existing = portablePaths.get(key)
    if (existing !== undefined) {
      throw extensionError('EXTENSION_PACKAGE_PATH_COLLISION', 'Package source paths collide portably', {
        first: existing,
        second: file.path
      })
    }
    portablePaths.set(key, file.path)
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return files
}

function archiveLimits(overrides: Partial<ExtensionArchiveLimits> | undefined): ExtensionArchiveLimits {
  const limits = { ...DEFAULT_EXTENSION_ARCHIVE_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw extensionError('EXTENSION_ARCHIVE_LIMIT_INVALID', 'Archive limit must be a positive integer', {
        name,
        value
      })
    }
  }
  return limits
}

function enforceLimit(name: string, value: number, maximum: number, path?: string): void {
  if (value <= maximum) return
  throw extensionError('EXTENSION_ARCHIVE_LIMIT_EXCEEDED', 'Extension package exceeds a safety limit', {
    limit: name,
    value,
    maximum,
    ...(path === undefined ? {} : { path })
  })
}

function portablePathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  const input = createReadStream(path)
  for await (const chunk of input) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

function setEquals<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}
