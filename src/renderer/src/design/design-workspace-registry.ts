const MAX_TRACKED_WORKSPACES = 8
const MAX_IDS_PER_BUCKET = 2_048

type WorkspaceRegistry = {
  removedArtifactIds: Set<string>
  removedDocumentIds: Set<string>
  userCreatedDocumentIds: Set<string>
}

const registries = new Map<string, WorkspaceRegistry>()

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function registryFor(workspaceRoot: string, create: boolean): WorkspaceRegistry | null {
  const key = normalizeWorkspaceRoot(workspaceRoot)
  if (!key) return null
  const existing = registries.get(key)
  if (existing) {
    registries.delete(key)
    registries.set(key, existing)
    return existing
  }
  if (!create) return null
  const registry: WorkspaceRegistry = {
    removedArtifactIds: new Set(),
    removedDocumentIds: new Set(),
    userCreatedDocumentIds: new Set()
  }
  registries.set(key, registry)
  while (registries.size > MAX_TRACKED_WORKSPACES) {
    const oldest = registries.keys().next().value as string | undefined
    if (oldest === undefined) break
    registries.delete(oldest)
  }
  return registry
}

function boundedAdd(bucket: Set<string>, id: string): void {
  const normalized = id.trim()
  if (!normalized) return
  bucket.delete(normalized)
  bucket.add(normalized)
  while (bucket.size > MAX_IDS_PER_BUCKET) {
    const oldest = bucket.values().next().value as string | undefined
    if (oldest === undefined) break
    bucket.delete(oldest)
  }
}

export function markDesignArtifactRemoved(workspaceRoot: string, artifactId: string): void {
  const registry = registryFor(workspaceRoot, true)
  if (registry) boundedAdd(registry.removedArtifactIds, artifactId)
}

export function markDesignDocumentRemoved(workspaceRoot: string, documentId: string): void {
  const registry = registryFor(workspaceRoot, true)
  if (registry) boundedAdd(registry.removedDocumentIds, documentId)
}

export function markDesignDocumentUserCreated(workspaceRoot: string, documentId: string): void {
  const registry = registryFor(workspaceRoot, true)
  if (registry) boundedAdd(registry.userCreatedDocumentIds, documentId)
}

export function wasDesignArtifactRemoved(workspaceRoot: string, artifactId: string): boolean {
  return registryFor(workspaceRoot, false)?.removedArtifactIds.has(artifactId) === true
}

export function wasDesignDocumentRemoved(workspaceRoot: string, documentId: string): boolean {
  return registryFor(workspaceRoot, false)?.removedDocumentIds.has(documentId) === true
}

export function wasDesignDocumentUserCreated(workspaceRoot: string, documentId: string): boolean {
  return registryFor(workspaceRoot, false)?.userCreatedDocumentIds.has(documentId) === true
}

export function clearDesignWorkspaceRegistry(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) {
    registries.clear()
    return
  }
  registries.delete(normalizeWorkspaceRoot(workspaceRoot))
}

export function designWorkspaceRegistryStats(): {
  workspaces: number
  removedArtifacts: number
  removedDocuments: number
  userCreatedDocuments: number
} {
  let removedArtifacts = 0
  let removedDocuments = 0
  let userCreatedDocuments = 0
  for (const registry of registries.values()) {
    removedArtifacts += registry.removedArtifactIds.size
    removedDocuments += registry.removedDocumentIds.size
    userCreatedDocuments += registry.userCreatedDocumentIds.size
  }
  return {
    workspaces: registries.size,
    removedArtifacts,
    removedDocuments,
    userCreatedDocuments
  }
}
