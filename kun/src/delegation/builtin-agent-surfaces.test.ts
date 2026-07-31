import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { BUILTIN_AGENT_CATALOG } from './builtin-agent-catalog.js'
import { BUILTIN_SUBAGENT_PROFILES, mergeBuiltinSubagentProfiles } from './builtin-profiles.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

describe('built-in subagent surfaces', () => {
  it('publishes exactly 45 complete built-in profiles', () => {
    expect(BUILTIN_AGENT_CATALOG).toHaveLength(45)
    expect(Object.keys(BUILTIN_SUBAGENT_PROFILES)).toHaveLength(45)
    for (const entry of BUILTIN_AGENT_CATALOG) {
      expect(BUILTIN_SUBAGENT_PROFILES[entry.id], entry.id).toBeDefined()
      expect(entry.routingTerms.length, entry.id).toBeGreaterThan(0)
      if (entry.family === 'base') expect(entry.surfaces.length, entry.id).toBeGreaterThan(0)
      else expect(entry.surfaces, entry.id).toEqual([])
    }
    expect(BUILTIN_SUBAGENT_PROFILES.general?.surfaces).toEqual(['shared'])
    expect(BUILTIN_AGENT_CATALOG.filter((entry) => entry.family === 'base')).toHaveLength(8)
    expect(BUILTIN_AGENT_CATALOG.filter((entry) => entry.family === 'skill')).toHaveLength(25)
    expect(BUILTIN_AGENT_CATALOG.filter((entry) => entry.family === 'write')).toHaveLength(6)
    expect(BUILTIN_AGENT_CATALOG.filter((entry) => entry.family === 'design')).toHaveLength(6)
    expect(BUILTIN_AGENT_CATALOG.filter((entry) => entry.family === 'base').map((entry) => entry.id)).toEqual([
      'general',
      'explore',
      'design-reviewer',
      'over-engineering-reviewer',
      'code-reviewer',
      'test-engineer',
      'security-auditor',
      'web-performance-auditor'
    ])
    expect(BUILTIN_AGENT_CATALOG.every((entry) => entry.recommendedSurfaces.length > 0)).toBe(true)
    expect(BUILTIN_AGENT_CATALOG.find((entry) => entry.id === 'design-reviewer')?.family).toBe('base')
    expect(BUILTIN_AGENT_CATALOG.find((entry) => entry.id === 'component-designer')?.family).toBe('skill')
  })

  it('limits routing and explicit snapshots to shared plus the active surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-agent-surfaces-'))
    try {
      const config = mergeBuiltinSubagentProfiles(SubagentsCapabilityConfig.parse({
        enabled: true,
        profiles: {
          'write-copy-editor': { surfaces: ['write'] },
          'design-screen-designer': { surfaces: ['design'] },
          'component-designer': { surfaces: ['code', 'design'] }
        }
      }))
      const runtime = new DelegationRuntime({
        config,
        store: new FileDelegationStore(dir),
        executor: async () => ({ summary: 'unused' })
      })
      const codeIds = new Set((await runtime.listRoutingProfiles(undefined, 'code')).map((item) => item.id))
      const writeIds = new Set((await runtime.listRoutingProfiles(undefined, 'write')).map((item) => item.id))
      const designIds = new Set((await runtime.listRoutingProfiles(undefined, 'design')).map((item) => item.id))

      expect(codeIds).toContain('general')
      expect(writeIds).toContain('general')
      expect(designIds).toContain('general')
      expect(writeIds).toContain('write-copy-editor')
      expect(writeIds).not.toContain('code-reviewer')
      expect(designIds).toContain('design-screen-designer')
      expect(designIds).not.toContain('write-draft-author')
      expect(codeIds).toContain('component-designer')
      expect(designIds).toContain('component-designer')
      await expect(runtime.resolveProfileSnapshot('write-copy-editor', undefined, 'code')).resolves.toBeUndefined()
      await expect(runtime.resolveProfileSnapshot('write-copy-editor', undefined, 'write')).resolves.toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
