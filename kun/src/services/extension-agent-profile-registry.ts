import { createHash } from 'node:crypto'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility
} from '../contracts/threads.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'

export type ExtensionAgentProfileDefinition = {
  id: string
  displayName: string
  description?: string
  instructionOverlay?: string
  providerBinding?: ExtensionProviderBinding
  allowedToolScopes?: string[]
  defaultBudget?: Partial<ExtensionRunBudget>
  visibility?: ExtensionThreadVisibility
}

export type ResolvedExtensionAgentProfile = {
  snapshot: ExtensionAgentProfileSnapshot
  providerBinding: ExtensionProviderBinding
  defaultBudget?: Partial<ExtensionRunBudget>
  visibility: ExtensionThreadVisibility
}

type RegisteredProfile = {
  extensionId: string
  extensionVersion: string
  definition: ExtensionAgentProfileDefinition
}

/**
 * Manifest-backed profile registry. Profile identity is always derived from
 * the authenticated extension namespace, never from a caller-supplied owner.
 */
export class ExtensionAgentProfileRegistry {
  private readonly profiles = new Map<string, RegisteredProfile>()

  register(input: {
    extensionId: string
    extensionVersion: string
    profiles: readonly ExtensionAgentProfileDefinition[]
  }): () => void {
    const inserted: string[] = []
    for (const definition of input.profiles) {
      validateDefinition(definition)
      const key = profileKey(input.extensionId, definition.id)
      if (this.profiles.has(key)) throw new Error(`extension profile already registered: ${key}`)
      this.profiles.set(key, {
        extensionId: input.extensionId,
        extensionVersion: input.extensionVersion,
        definition: structuredClone(definition)
      })
      inserted.push(key)
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      for (const key of inserted) {
        const current = this.profiles.get(key)
        if (current?.extensionVersion === input.extensionVersion) this.profiles.delete(key)
      }
    }
  }

  resolve(input: {
    extensionId: string
    profileId: string
    fallbackBinding: ExtensionProviderBinding
  }): ResolvedExtensionAgentProfile {
    const registered = this.profiles.get(profileKey(input.extensionId, input.profileId))
    if (!registered) throw new Error(`extension profile not found: ${input.profileId}`)
    const definition = registered.definition
    const binding = definition.providerBinding ?? input.fallbackBinding
    const overlay = definition.instructionOverlay?.trim()
    return {
      snapshot: {
        id: definition.id,
        instructionDigest: digest(overlay ?? ''),
        ...(overlay ? { instructionOverlay: overlay } : {}),
        model: binding.modelId,
        providerId: binding.providerId,
        ...(binding.accountId ? { accountId: binding.accountId } : {}),
        allowedToolScopes: canonicalStrings(definition.allowedToolScopes ?? [])
      },
      providerBinding: { ...binding },
      ...(definition.defaultBudget ? { defaultBudget: { ...definition.defaultBudget } } : {}),
      visibility: definition.visibility ?? 'private'
    }
  }

  listOwn(extensionId: string): ExtensionAgentProfileDefinition[] {
    return [...this.profiles.values()]
      .filter((entry) => entry.extensionId === extensionId)
      .map((entry) => structuredClone(entry.definition))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}

function validateDefinition(definition: ExtensionAgentProfileDefinition): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(definition.id)) {
    throw new Error(`invalid extension profile id: ${definition.id}`)
  }
  if (!definition.displayName.trim()) throw new Error(`extension profile displayName is required: ${definition.id}`)
  if ((definition.instructionOverlay?.length ?? 0) > 32_000) {
    throw new Error(`extension profile instruction overlay exceeds 32000 characters: ${definition.id}`)
  }
  const binding = definition.providerBinding
  if (binding && (!binding.providerId.trim() || !binding.modelId.trim())) {
    throw new Error(`extension profile provider binding is incomplete: ${definition.id}`)
  }
}

function profileKey(extensionId: string, profileId: string): string {
  return `${extensionId}/${profileId}`
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
