import {
  artifactDesignMdPath,
  artifactDesignMdPathOf,
  artifactDirOf,
  artifactDirPath,
  artifactMetaPathOf,
  serializeArtifactMeta
} from '../design-artifact-persistence'
import {
  createDesignArtifactId,
  currentDesignArtifactVersion,
  designArtifactVersionNumber,
  defaultDesignArtifactNode
} from '../design-types'
import type { DesignArtifact, DesignArtifactVersion } from '../design-types'
import type { DesignWorkspaceState } from '../design-workspace-store-types'
import { svgArtifactStatusForSource } from '../svg/svg-artifact-status'
import { buildSvgArtifactSkeleton } from '../svg/svg-skeleton'
import {
  applyToContextDocument,
  assertSvgPrepareContext,
  type SvgPrepareContext
} from './svg-turn-context'
import {
  deleteDesignWorkspaceEntry,
  writeDesignWorkspaceFile
} from '../design-persistence-coordinator'

type SetDesignWorkspaceState = (
  partial:
    | Partial<DesignWorkspaceState>
    | ((state: DesignWorkspaceState) => Partial<DesignWorkspaceState>)
) => void

export type PrepareSvgTurnOptions = {
  forceNew?: boolean
  /** Stable id supplied by design_svg_create for replay-safe creation. */
  artifactId?: string
  activate?: boolean
  reusePendingInitial?: boolean
  width?: number
  height?: number
  title?: string
}

type PrepareSvgTurnArgs = {
  brief: string
  options?: PrepareSvgTurnOptions
  get: () => DesignWorkspaceState
  set: SetDesignWorkspaceState
  persistIndex: () => void
}

export type PreparedSvgTurn = {
  artifactId: string
  relativePath: string
  basePath?: string
  designMdPath: string
  /** True only when this call created the artifact and its initial SVG file. */
  newlyCreated: boolean
  /** True when this call created a new immutable version file. */
  versionCreated: boolean
  /** Revert this not-yet-dispatched version without touching stable initial reservations. */
  rollbackPreparedVersion?: () => Promise<void>
}

const prepareQueues = new Map<string, Promise<PreparedSvgTurn>>()

function svgTitle(brief: string, explicit?: string): string {
  const title = explicit?.trim() || brief.trim()
  return title.length > 48 ? `${title.slice(0, 48)}...` : title || 'SVG motion'
}

function svgNode(index: number, width?: number, height?: number) {
  return {
    ...defaultDesignArtifactNode(index),
    width: Math.min(4096, Math.max(64, width ?? 640)),
    height: Math.min(4096, Math.max(64, height ?? 480)),
    sizeMode: 'manual' as const,
    viewMode: 'preview' as const
  }
}

function validArtifactId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
}

function nextSvgVersionNumber(
  artifact: Pick<DesignArtifact, 'relativePath' | 'versions'>,
  diskVersions: readonly number[] = []
): number {
  const knownVersions = [
    ...artifact.versions,
    { id: '', relativePath: artifact.relativePath }
  ]
  return Math.max(
    0,
    ...diskVersions,
    ...knownVersions.map((version) => designArtifactVersionNumber(version) ?? 0)
  ) + 1
}

function requireSvgFileApi() {
  const api = typeof window !== 'undefined' ? window.kunGui : undefined
  if (
    !api ||
    typeof api.readWorkspaceFile !== 'function' ||
    typeof api.writeWorkspaceFile !== 'function' ||
    typeof api.createWorkspaceFile !== 'function' ||
    typeof api.listWorkspaceDirectory !== 'function'
  ) {
    throw new Error('SVG workspace file access is unavailable.')
  }
  return api
}

async function persistMetaStrict(workspaceRoot: string, artifact: DesignArtifact): Promise<void> {
  const api = requireSvgFileApi()
  const result = await writeDesignWorkspaceFile({
    path: artifactMetaPathOf(artifact.relativePath),
    workspaceRoot,
    content: serializeArtifactMeta(artifact)
  }, api)
  if (!result.ok) throw new Error(`Could not persist SVG metadata: ${result.message}`)
}

async function deleteEntryBestEffort(workspaceRoot: string, path: string): Promise<void> {
  const api = typeof window !== 'undefined' ? window.kunGui : undefined
  if (typeof api?.deleteWorkspaceEntry !== 'function') return
  await deleteDesignWorkspaceEntry({ path, workspaceRoot }, api)
}

async function restoreOrDeleteMetaBestEffort(
  workspaceRoot: string,
  relativePath: string,
  previousContent: string | null
): Promise<void> {
  const metaPath = artifactMetaPathOf(relativePath)
  if (previousContent === null) {
    await deleteEntryBestEffort(workspaceRoot, metaPath)
    return
  }
  const api = typeof window !== 'undefined' ? window.kunGui : undefined
  if (typeof api?.writeWorkspaceFile !== 'function') return
  await writeDesignWorkspaceFile({ path: metaPath, workspaceRoot, content: previousContent }, api)
}

async function readExistingMeta(workspaceRoot: string, relativePath: string): Promise<string | null> {
  const result = await requireSvgFileApi().readWorkspaceFile({
    path: artifactMetaPathOf(relativePath),
    workspaceRoot
  }).catch(() => null)
  if (!result?.ok) return null
  if (result.truncated) throw new Error('Existing SVG metadata is too large to replace safely.')
  return result.content
}

async function readSvgFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const result = await requireSvgFileApi().readWorkspaceFile({ path: relativePath, workspaceRoot })
  if (!result.ok) throw new Error(`Could not read SVG source ${relativePath}: ${result.message}`)
  if (result.truncated) throw new Error(`SVG source ${relativePath} is too large to version safely.`)
  return result.content
}

async function createSvgFile(
  workspaceRoot: string,
  relativePath: string,
  content: string
): Promise<void> {
  const result = await requireSvgFileApi().createWorkspaceFile({
    path: relativePath,
    workspaceRoot,
    content
  })
  if (!result.ok) throw new Error(`Could not create SVG file ${relativePath}: ${result.message}`)
}

async function diskSvgVersions(workspaceRoot: string, dir: string): Promise<number[]> {
  const result = await requireSvgFileApi().listWorkspaceDirectory({ path: dir, workspaceRoot })
  if (!result.ok) throw new Error(`Could not inspect SVG versions in ${dir}: ${result.message}`)
  return result.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => /^v(\d+)\.svg$/i.exec(entry.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .filter((version) => Number.isSafeInteger(version) && version > 0)
}

async function createNextSvgVersion(options: {
  workspaceRoot: string
  artifact: DesignArtifact
  content: string
}): Promise<{ version: DesignArtifactVersion; relativePath: string }> {
  const api = requireSvgFileApi()
  const dir = artifactDirOf(options.artifact.relativePath)
  const onDisk = await diskSvgVersions(options.workspaceRoot, dir)
  let versionN = nextSvgVersionNumber(options.artifact, onDisk)
  for (let attempt = 0; attempt < 100; attempt += 1, versionN += 1) {
    const relativePath = `${dir}/v${versionN}.svg`
    const created = await api.createWorkspaceFile({
      path: relativePath,
      workspaceRoot: options.workspaceRoot,
      content: options.content
    })
    if (created.ok) {
      const createdAt = new Date().toISOString()
      return {
        relativePath,
        version: {
          id: `${options.artifact.id}-v${versionN}`,
          relativePath,
          createdAt,
          summary: ''
        }
      }
    }
    if (!/already exists/i.test(created.message)) {
      throw new Error(`Could not create SVG version ${relativePath}: ${created.message}`)
    }
  }
  throw new Error(`Could not allocate a free SVG version in ${dir}.`)
}

async function commitInitialArtifact(options: {
  artifact: DesignArtifact
  activate: boolean
  context: SvgPrepareContext
  get: () => DesignWorkspaceState
  set: SetDesignWorkspaceState
  persistIndex: () => void
}): Promise<void> {
  const state = assertSvgPrepareContext(options.get, options.context)
  const previousActiveId = state.documents.find(
    (document) => document.id === options.context.documentId
  )?.activeArtifactId ?? null
  options.set((current) =>
    applyToContextDocument(
      current,
      options.context,
      (artifacts) => [options.artifact, ...artifacts.filter((item) => item.id !== options.artifact.id)],
      options.activate ? options.artifact.id : previousActiveId
    )
  )
  try {
    await persistMetaStrict(options.context.workspaceRoot, options.artifact)
    assertSvgPrepareContext(options.get, options.context)
    options.persistIndex()
  } catch (error) {
    options.set((current) =>
      applyToContextDocument(
        current,
        options.context,
        (artifacts) => artifacts.filter((item) => item.id !== options.artifact.id),
        previousActiveId
      )
    )
    throw error
  }
}

async function commitExistingArtifact(options: {
  before: DesignArtifact
  after: DesignArtifact
  activate: boolean
  context: SvgPrepareContext
  get: () => DesignWorkspaceState
  set: SetDesignWorkspaceState
  persistIndex: () => void
}): Promise<void> {
  const state = assertSvgPrepareContext(options.get, options.context)
  const previousActiveId = state.documents.find(
    (document) => document.id === options.context.documentId
  )?.activeArtifactId ?? null
  options.set((current) =>
    applyToContextDocument(
      current,
      options.context,
      (artifacts) => artifacts.map((item) => item.id === options.after.id ? options.after : item),
      options.activate ? options.after.id : previousActiveId
    )
  )
  try {
    await persistMetaStrict(options.context.workspaceRoot, options.after)
    assertSvgPrepareContext(options.get, options.context)
    options.persistIndex()
  } catch (error) {
    options.set((current) =>
      applyToContextDocument(
        current,
        options.context,
        (artifacts) => artifacts.map((item) => item.id === options.before.id ? options.before : item),
        previousActiveId
      )
    )
    await persistMetaStrict(options.context.workspaceRoot, options.before).catch(() => undefined)
    throw error
  }
}

function preparedVersionRollback(options: {
  before: DesignArtifact
  after: DesignArtifact
  createdPath: string
  context: SvgPrepareContext
  get: () => DesignWorkspaceState
  set: SetDesignWorkspaceState
  persistIndex: () => void
}): () => Promise<void> {
  let finished = false
  return async () => {
    if (finished) return
    const state = options.get()
    const document = state.workspaceRoot === options.context.workspaceRoot
      ? state.documents.find((candidate) => candidate.id === options.context.documentId)
      : undefined
    const current = document?.artifacts.find((artifact) => artifact.id === options.after.id)
    if (current && current.relativePath !== options.createdPath) {
      finished = true
      return
    }
    if (document) {
      options.set((currentState) =>
        applyToContextDocument(
          currentState,
          options.context,
          (artifacts) => artifacts.map((artifact) =>
            artifact.id === options.before.id ? options.before : artifact
          ),
          document.activeArtifactId
        )
      )
    }
    try {
      await persistMetaStrict(options.context.workspaceRoot, options.before)
    } catch (error) {
      if (document) {
        options.set((currentState) =>
          applyToContextDocument(
            currentState,
            options.context,
            (artifacts) => artifacts.map((artifact) =>
              artifact.id === options.after.id ? options.after : artifact
            ),
            document.activeArtifactId
          )
        )
      }
      throw error
    }
    await deleteEntryBestEffort(options.context.workspaceRoot, options.createdPath)
    if (
      options.get().workspaceRoot === options.context.workspaceRoot &&
      options.get().documents.some((candidate) => candidate.id === options.context.documentId)
    ) {
      options.persistIndex()
    }
    finished = true
  }
}

async function prepareDesignSvgTurnImpl({
  brief,
  options,
  get,
  set,
  persistIndex,
  artifactId,
  context
}: PrepareSvgTurnArgs & {
  options: PrepareSvgTurnOptions
  artifactId: string
  context: SvgPrepareContext
}): Promise<PreparedSvgTurn> {
  const text = brief.trim()
  const state = assertSvgPrepareContext(get, context)
  const target = state.artifacts.find((item) => item.id === artifactId) ?? null
  if (target && target.kind !== 'svg') {
    throw new Error(`Artifact id ${artifactId} is already used by a non-SVG artifact.`)
  }
  const activeSvg = target?.kind === 'svg' ? target : null

  if (activeSvg && options.forceNew && options.artifactId) {
    return {
      artifactId: activeSvg.id,
      relativePath: activeSvg.relativePath,
      designMdPath: activeSvg.designMdPath ?? artifactDesignMdPathOf(activeSvg.relativePath),
      newlyCreated: false,
      versionCreated: false
    }
  }

  if (
    activeSvg &&
    options.reusePendingInitial &&
    activeSvg.previewStatus === 'pending' &&
    activeSvg.versions.length === 1 &&
    activeSvg.versions[0]?.relativePath === activeSvg.relativePath
  ) {
    const source = await readSvgFile(context.workspaceRoot, activeSvg.relativePath)
    if (svgArtifactStatusForSource(source) === 'pending') {
      const createdAt = new Date().toISOString()
      const designMdPath = activeSvg.designMdPath ?? artifactDesignMdPathOf(activeSvg.relativePath)
      const after: DesignArtifact = {
        ...activeSvg,
        updatedAt: createdAt,
        designMdPath,
        previewStatus: 'pending',
        versions: activeSvg.versions.map((version) =>
          version.id === activeSvg.versions[0]?.id ? { ...version, summary: text } : version
        )
      }
      await commitExistingArtifact({
        before: activeSvg,
        after,
        activate: options.activate !== false,
        context,
        get,
        set,
        persistIndex
      })
      return {
        artifactId: activeSvg.id,
        relativePath: activeSvg.relativePath,
        designMdPath,
        newlyCreated: false,
        versionCreated: false
      }
    }
  }

  if (activeSvg) {
    const source = await readSvgFile(state.workspaceRoot, activeSvg.relativePath)
    const created = await createNextSvgVersion({
      workspaceRoot: context.workspaceRoot,
      artifact: activeSvg,
      content: source
    })
    created.version.summary = text
    const designMdPath = activeSvg.designMdPath ?? artifactDesignMdPathOf(activeSvg.relativePath)
    const after: DesignArtifact = {
      ...activeSvg,
      relativePath: created.relativePath,
      updatedAt: created.version.createdAt,
      versions: [created.version, ...activeSvg.versions],
      designMdPath,
      previewStatus: 'pending'
    }
    try {
      await commitExistingArtifact({
        before: activeSvg,
        after,
        activate: options.activate !== false,
        context,
        get,
        set,
        persistIndex
      })
    } catch (error) {
      await deleteEntryBestEffort(context.workspaceRoot, created.relativePath)
      throw error
    }
    return {
      artifactId: activeSvg.id,
      relativePath: created.relativePath,
      basePath: activeSvg.relativePath,
      designMdPath,
      newlyCreated: false,
      versionCreated: true,
      rollbackPreparedVersion: preparedVersionRollback({
        before: activeSvg,
        after,
        createdPath: created.relativePath,
        context,
        get,
        set,
        persistIndex
      })
    }
  }

  const docId = context.documentId
  const createdAt = new Date().toISOString()
  const relativePath = `${artifactDirPath(docId, artifactId)}/v1.svg`
  const designMdPath = artifactDesignMdPath(docId, artifactId)
  const node = svgNode(state.artifacts.length, options.width, options.height)
  const artifact: DesignArtifact = {
    id: artifactId,
    kind: 'svg',
    title: svgTitle(text, options.title),
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: text }],
    designMdPath,
    previewStatus: 'pending',
    node
  }
  const previousMeta = await readExistingMeta(context.workspaceRoot, relativePath)
  await createSvgFile(
    context.workspaceRoot,
    relativePath,
    buildSvgArtifactSkeleton({
      title: artifact.title,
      brief: text,
      width: node.width,
      height: node.height
    })
  )
  try {
    await commitInitialArtifact({
      artifact,
      activate: options.activate !== false,
      context,
      get,
      set,
      persistIndex
    })
  } catch (error) {
    await deleteEntryBestEffort(context.workspaceRoot, relativePath)
    await restoreOrDeleteMetaBestEffort(context.workspaceRoot, relativePath, previousMeta)
    throw error
  }
  return {
    artifactId,
    relativePath,
    designMdPath,
    newlyCreated: true,
    versionCreated: true
  }
}

export function prepareDesignSvgTurn({
  brief,
  options = {},
  get,
  set,
  persistIndex
}: PrepareSvgTurnArgs): Promise<PreparedSvgTurn> {
  const docId = get().ensureActiveDocument()
  const state = get()
  const context: SvgPrepareContext = { workspaceRoot: state.workspaceRoot, documentId: docId }
  const active = state.artifacts.find((item) => item.id === state.activeArtifactId) ?? null
  const requested = options.artifactId?.trim()
  const target = requested
    ? state.artifacts.find((item) => item.id === requested) ?? null
    : !options.forceNew && active?.kind === 'svg'
      ? active
      : null
  const artifactId = target?.id ?? requested ?? createDesignArtifactId()
  if (!validArtifactId(artifactId)) {
    return Promise.reject(new Error(`Invalid SVG artifact id: ${artifactId}`))
  }
  const queueKey = [state.workspaceRoot, docId, artifactId].join('\0')
  const pending = prepareQueues.get(queueKey)
  if (pending) {
    if (options.forceNew && options.artifactId) {
      return pending.then((result) => ({ ...result, newlyCreated: false, versionCreated: false }))
    }
    const queued = pending
      .catch(() => undefined)
      .then(() => prepareDesignSvgTurnImpl({
        brief,
        options,
        get,
        set,
        persistIndex,
        artifactId,
        context
      }))
    prepareQueues.set(queueKey, queued)
    void queued.finally(() => {
      if (prepareQueues.get(queueKey) === queued) prepareQueues.delete(queueKey)
    }).catch(() => undefined)
    return queued
  }
  const task = prepareDesignSvgTurnImpl({
    brief,
    options,
    get,
    set,
    persistIndex,
    artifactId,
    context
  })
  prepareQueues.set(queueKey, task)
  void task.finally(() => {
    if (prepareQueues.get(queueKey) === task) prepareQueues.delete(queueKey)
  }).catch(() => undefined)
  return task
}

export async function duplicateSvgArtifact(
  artifactId: string,
  get: () => DesignWorkspaceState
): Promise<void> {
  const state = get()
  const source = state.artifacts.find((item) => item.id === artifactId)
  const workspaceRoot = state.workspaceRoot
  if (
    !source ||
    source.kind !== 'svg' ||
    !workspaceRoot ||
    typeof window.kunGui?.readWorkspaceFile !== 'function' ||
    typeof window.kunGui?.createWorkspaceFile !== 'function'
  ) {
    return
  }
  const context = {
    workspaceRoot,
    documentId: state.activeDocumentId
  }
  if (!context.documentId) return
  const contextMatches = (): boolean => {
    const current = get()
    return current.workspaceRoot === context.workspaceRoot && current.activeDocumentId === context.documentId
  }
  const read = await window.kunGui.readWorkspaceFile({ path: source.relativePath, workspaceRoot }).catch(() => null)
  if (!read?.ok || read.truncated) return
  if (!contextMatches()) return
  const docId = context.documentId
  const createdAt = new Date().toISOString()
  const copyId = createDesignArtifactId()
  const relativePath = `${artifactDirPath(docId, copyId)}/v1.svg`
  const designMdPath = artifactDesignMdPath(docId, copyId)
  const write = await window.kunGui
    .createWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
    .catch(() => null)
  if (!write?.ok) return
  const rollbackCopy = async (): Promise<void> => {
    await deleteEntryBestEffort(workspaceRoot, relativePath)
    await deleteEntryBestEffort(workspaceRoot, designMdPath)
  }
  if (!contextMatches()) {
    await rollbackCopy()
    return
  }
  const sourceNotes = source.designMdPath ?? artifactDesignMdPathOf(source.relativePath)
  const notes = await window.kunGui.readWorkspaceFile({ path: sourceNotes, workspaceRoot }).catch(() => null)
  if (notes?.ok && typeof window.kunGui.writeWorkspaceFile === 'function') {
    await writeDesignWorkspaceFile({ path: designMdPath, workspaceRoot, content: notes.content })
  }
  if (!contextMatches()) {
    await rollbackCopy()
    return
  }
  const previewStatus = svgArtifactStatusForSource(read.content)
  const sourceNode = source.node ?? defaultDesignArtifactNode(state.artifacts.indexOf(source))
  get().upsertArtifact({
    id: copyId,
    kind: 'svg',
    title: `${source.title} copy`,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{
      id: `${copyId}-v1`,
      relativePath,
      createdAt,
      summary: currentDesignArtifactVersion(source)?.summary ?? ''
    }],
    designMdPath,
    previewStatus,
    node: { ...sourceNode, x: sourceNode.x + 44, y: sourceNode.y + 44, boardHidden: false }
  })
}
