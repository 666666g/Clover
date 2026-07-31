import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDesignWorkspaceRegistry,
  designWorkspaceRegistryStats,
  markDesignArtifactRemoved,
  markDesignDocumentRemoved,
  wasDesignArtifactRemoved,
  wasDesignDocumentRemoved
} from './design-workspace-registry'

afterEach(() => clearDesignWorkspaceRegistry())

describe('design workspace hydration registry', () => {
  it('isolates identical artifact and document ids between workspaces', () => {
    markDesignArtifactRemoved('/workspace/a', 'shared')
    markDesignDocumentRemoved('/workspace/a', 'doc')

    expect(wasDesignArtifactRemoved('/workspace/a', 'shared')).toBe(true)
    expect(wasDesignArtifactRemoved('/workspace/b', 'shared')).toBe(false)
    expect(wasDesignDocumentRemoved('/workspace/a', 'doc')).toBe(true)
    expect(wasDesignDocumentRemoved('/workspace/b', 'doc')).toBe(false)
  })

  it('bounds the number of retained workspace registries', () => {
    for (let index = 0; index < 12; index += 1) {
      markDesignArtifactRemoved(`/workspace/${index}`, `artifact-${index}`)
    }

    expect(designWorkspaceRegistryStats().workspaces).toBe(8)
    expect(wasDesignArtifactRemoved('/workspace/0', 'artifact-0')).toBe(false)
    expect(wasDesignArtifactRemoved('/workspace/11', 'artifact-11')).toBe(true)
  })
})
