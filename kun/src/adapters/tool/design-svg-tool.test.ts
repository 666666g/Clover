import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'
import { LocalToolHost } from './local-tool-host.js'
import {
  createDesignSvgAnimateTool,
  createDesignSvgEditTool,
  createDesignSvgInspectTool,
  createDesignSvgValidateTool,
  DESIGN_SVG_EDIT_MAX_BATCH_OPS,
  DESIGN_SVG_EDIT_MAX_ELEMENT_DEPTH,
  DESIGN_SVG_EDIT_MAX_ELEMENTS
} from './design-svg-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const workspaces: string[] = []
const relativePath = '.kun-design/doc/artifact/v1.svg'

function context(workspace: string, path = relativePath): ToolHostContext {
  return {
    threadId: 'thread_svg',
    turnId: 'turn_svg',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    guiDesignMode: true,
    guiDesignArtifact: {
      kind: 'svg',
      artifactId: 'artifact',
      relativePath: path
    }
  }
}

async function workspaceWithSvg(source = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" role="img" aria-labelledby="title desc">',
  '  <title id="title">Motion mark</title>',
  '  <desc id="desc">A test vector animation.</desc>',
  '  <g id="artwork" />',
  '</svg>'
].join('\n')): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'kun-design-svg-'))
  workspaces.push(workspace)
  const absolutePath = join(workspace, relativePath)
  await mkdir(join(workspace, '.kun-design/doc/artifact'), { recursive: true })
  await writeFile(absolutePath, source, 'utf8')
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe('design SVG tools', () => {
  it('advertises tools only when a reserved SVG artifact is active', async () => {
    const workspace = await workspaceWithSvg()
    const tool = createDesignSvgInspectTool()
    expect(tool.shouldAdvertise?.(context(workspace))).toBe(true)
    expect(tool.shouldAdvertise?.({ ...context(workspace), guiDesignArtifact: undefined })).toBe(false)
    expect(tool.shouldAdvertise?.({ ...context(workspace), guiDesignMode: undefined })).toBe(false)
  })

  it('edits real SVG structure and adds declarative transform and path-draw animation', async () => {
    const workspace = await workspaceWithSvg()
    const edit = await createDesignSvgEditTool().execute({
      ops: [
        { op: 'set-document', attributes: { viewBox: '0 0 240 160', width: 240, height: 160 } },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'defs',
            id: 'paint',
            children: [{
              tag: 'linearGradient',
              id: 'brand-gradient',
              attributes: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              children: [
                { tag: 'stop', id: 'brand-start', attributes: { offset: 0, 'stop-color': '#7c3aed' } },
                { tag: 'stop', id: 'brand-end', attributes: { offset: 1, 'stop-color': '#22d3ee' } }
              ]
            }]
          }
        },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'rect',
            id: 'card',
            attributes: { x: 40, y: 24, width: 160, height: 112, rx: 28, fill: 'url(#brand-gradient)' }
          }
        },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'path',
            id: 'orbit',
            attributes: { d: 'M60 80 C90 24 150 24 180 80', fill: 'none', stroke: '#fff', 'stroke-width': 6 }
          }
        }
      ]
    }, context(workspace))
    expect(edit.isError).toBeUndefined()
    expect(edit.output).toMatchObject({ ok: true, affectedIds: ['paint', 'card', 'orbit'] })

    const animate = await createDesignSvgAnimateTool().execute({
      animations: [
        {
          id: 'card-pulse',
          targetId: 'card',
          kind: 'transform',
          transformType: 'scale',
          values: ['1 1', '1.05 1.05', '1 1'],
          keyTimes: [0, 0.5, 1],
          durationMs: 1400,
          iterations: 'infinite'
        },
        {
          id: 'orbit-draw',
          targetId: 'orbit',
          kind: 'path-draw',
          durationMs: 900
        },
        {
          id: 'card-motion',
          targetId: 'card',
          kind: 'motion',
          path: 'M0 0 C10 -8 20 -8 30 0',
          durationMs: 1800,
          iterations: 'infinite'
        }
      ]
    }, context(workspace))
    expect(animate.isError).toBeUndefined()
    expect(animate.output).toMatchObject({ ok: true })

    const inspect = await createDesignSvgInspectTool().execute({}, context(workspace))
    expect(inspect.output).toMatchObject({ ok: true, viewBox: '0 0 240 160', animationCount: 3 })
    const validate = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(validate.isError).toBe(false)
    expect(validate.output).toMatchObject({ ok: true })

    const source = await readFile(join(workspace, relativePath), 'utf8')
    expect(source).toContain('<linearGradient')
    expect(source).toContain('<animateTransform')
    expect(source).toContain('<animateMotion')
    expect(source).toContain('stroke-dasharray="1"')
    expect(source).not.toContain('<script')
  })

  it('supports default artwork parenting and ids created earlier in the same batch', async () => {
    const tool = createDesignSvgEditTool()
    expect(tool.description).toContain('20-50')
    expect(JSON.stringify(tool.inputSchema)).toContain(`"maxItems":${DESIGN_SVG_EDIT_MAX_BATCH_OPS}`)
    const workspace = await workspaceWithSvg()
    const edit = await tool.execute({
      ops: [
        { op: 'add', element: { tag: 'g', id: 'new-group' } },
        {
          op: 'add',
          parentId: 'new-group',
          element: { tag: 'rect', id: 'new-rect', attributes: { width: 10, height: 10 } }
        }
      ]
    }, context(workspace))
    expect(edit.isError).toBeUndefined()
    const source = await readFile(join(workspace, relativePath), 'utf8')
    expect(source).toContain('<g id="artwork"><g id="new-group"><rect id="new-rect"')
  })

  it('rejects oversized SVG edit batches before mutation', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const tool = createDesignSvgEditTool()

    const oversized = await tool.execute({
      ops: Array.from({ length: DESIGN_SVG_EDIT_MAX_BATCH_OPS + 1 }, (_, index) => ({
        op: 'add', element: { tag: 'rect', id: `rect-${index}` }
      }))
    }, context(workspace))
    expect(oversized.isError).toBe(true)
    expect(oversized.output).toMatchObject({
      ok: false,
      error: expect.stringContaining(`at most ${DESIGN_SVG_EDIT_MAX_BATCH_OPS} operations`)
    })

    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })

  it('rejects unsafe elements and external resources without mutating the artifact', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const script = await createDesignSvgEditTool().execute({
      ops: [{ op: 'add', parentId: 'artwork', element: { tag: 'script', id: 'payload', text: 'alert(1)' } }]
    }, context(workspace))
    expect(script.isError).toBe(true)
    expect(script.output).toMatchObject({ ok: false, error: expect.stringContaining('unsupported SVG element') })

    const remoteImage = await createDesignSvgEditTool().execute({
      ops: [{
        op: 'add',
        parentId: 'artwork',
        element: { tag: 'image', id: 'remote', attributes: { href: 'https://example.com/tracker.png' } }
      }]
    }, context(workspace))
    expect(remoteImage.isError).toBe(true)
    expect(remoteImage.output).toMatchObject({ ok: false, error: expect.stringContaining('unsafe SVG attribute') })
    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })

  it('rejects artifact paths that escape the reserved .kun-design version layout', async () => {
    const workspace = await workspaceWithSvg()
    const result = await createDesignSvgInspectTool().execute(
      {},
      context(workspace, '../outside/v1.svg')
    )
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false, error: expect.stringContaining('workspace root') })
  })

  it('reports unsafe content in a hand-authored SVG', async () => {
    const workspace = await workspaceWithSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script id="bad">alert(1)</script><image id="remote" href="https://example.com/x.png" /></svg>'
    )
    const result = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false })
    expect(JSON.stringify(result.output)).toContain('unsafe-element')
    expect(JSON.stringify(result.output)).toContain('unsafe-attribute')
  })

  it('rejects skeleton-only SVGs and definition-only graphics as unfinished', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '  <title id="title">Empty</title><desc id="desc">Definitions only.</desc>',
      '  <defs><path id="hidden-shape" d="M0 0 L10 10" /></defs><g id="artwork" />',
      '</svg>'
    ].join('\n'))
    const validated = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(validated.isError).toBe(true)
    expect(JSON.stringify(validated.output)).toContain('missing-visible-content')
    expect(validated.output).not.toHaveProperty('elements')

    const before = await readFile(join(workspace, relativePath), 'utf8')
    const superficialEdit = await createDesignSvgEditTool().execute({
      ops: [{ op: 'update', id: 'artwork', attributes: { opacity: 1 } }]
    }, context(workspace))
    expect(superficialEdit.isError).toBe(true)
    expect(await readFile(join(workspace, relativePath), 'utf8')).toBe(before)
  })

  it('does not count explicitly hidden graphics as visible completion', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">Hidden</title><desc id="desc">All graphics are hidden.</desc>',
      '<g id="artwork" opacity="0">',
      '  <rect id="hidden-by-parent" width="10" height="10"/>',
      '</g>',
      '<circle id="hidden-display" cx="5" cy="5" r="2" style="display: none !important"/>',
      '<path id="hidden-visibility" d="M0 0 L10 10" visibility="collapse"/>',
      '</svg>'
    ].join(''))
    const validated = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(validated.isError).toBe(true)
    expect(JSON.stringify(validated.output)).toContain('missing-visible-content')
  })

  it('keeps successful validation metadata inline for large SVG source files', async () => {
    const longPath = `M0 0 ${'L1 1 '.repeat(7_000)}`
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">Large</title><desc id="desc">Large but valid paths.</desc><g id="artwork">',
      ...Array.from({ length: 4 }, (_, index) => `<path id="p${index}" d="${longPath}"/>`),
      '</g></svg>'
    ].join(''))
    const artifactStore = new InMemoryArtifactStore()
    const host = new LocalToolHost({ tools: [createDesignSvgValidateTool()] })
    const result = await host.execute({
      callId: 'validate_large',
      toolName: 'design_svg_validate',
      arguments: {}
    }, { ...context(workspace), artifactStore })
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('expected tool result')
    expect(result.item.output).toMatchObject({ ok: true, revision: expect.any(String) })
    expect(result.item.output).not.toHaveProperty('artifactId')
    expect(Buffer.byteLength(JSON.stringify(result.item.output), 'utf8')).toBeLessThan(128 * 1024)
  })

  it('uses inspect handles to repair id-less and unsupported existing nodes', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
      '  <title>Imported mark</title>',
      '  <desc>Imported vector with no layer ids.</desc>',
      '  <g><rect x="4" y="4" width="20" height="20" /></g>',
      '  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>',
      '</svg>'
    ].join('\n'))
    const inspect = await createDesignSvgInspectTool().execute({}, context(workspace))
    const inspected = inspect.output as {
      revision: string
      elements: Array<{ tag: string; id: string | null; handle: string }>
    }
    const rect = inspected.elements.find((element) => element.tag === 'rect')
    const foreignObject = inspected.elements.find((element) => element.tag === 'foreignobject')
    expect(rect).toMatchObject({ id: null, handle: '0/2/0' })
    expect(foreignObject).toMatchObject({ id: null, handle: '0/3' })

    const edit = await createDesignSvgEditTool().execute({
      expectedRevision: inspected.revision,
      ops: [
        { op: 'update', handle: rect?.handle, attributes: { id: 'imported-card', fill: '#0f172a' } },
        { op: 'delete', handle: foreignObject?.handle }
      ]
    }, context(workspace))
    expect(edit.isError).toBeUndefined()
    expect(edit.output).toMatchObject({ ok: true, affectedIds: ['imported-card', '0/3'] })
    const source = await readFile(join(workspace, relativePath), 'utf8')
    expect(source).toContain('id="imported-card"')
    expect(source).not.toContain('foreignObject')
  })

  it('pages inspect handles so id-less elements beyond the first 400 remain editable', async () => {
    const rects = Array.from({ length: 405 }, (_, index) =>
      `<rect x="${index}" y="0" width="1" height="1" />`)
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 20">',
      '  <title id="title">Many nodes</title><desc id="desc">Paged imported nodes.</desc>',
      `  <g id="artwork">${rects.join('')}</g>`,
      '</svg>'
    ].join('\n'))
    const inspected = await createDesignSvgInspectTool().execute({ offset: 400, limit: 10 }, context(workspace))
    const output = inspected.output as {
      elementCount: number
      revision: string
      offset: number
      truncated: boolean
      elements: Array<{ tag: string; handle: string; id: string | null }>
    }
    expect(output).toMatchObject({ elementCount: 409, offset: 400, truncated: true })
    const lateRect = output.elements.find((element) => element.tag === 'rect')
    expect(lateRect?.id).toBeNull()
    const edited = await createDesignSvgEditTool().execute({
      expectedRevision: output.revision,
      ops: [{ op: 'update', handle: lateRect?.handle, attributes: { id: 'late-node' } }]
    }, context(workspace))
    expect(edited.isError).toBeUndefined()
    expect(await readFile(join(workspace, relativePath), 'utf8')).toContain('id="late-node"')
  })

  it('binds structural handles to an inspect revision and resolves a whole batch before mutation', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
      '  <title id="title">Handles</title><desc id="desc">Stable batch targets.</desc>',
      '  <g id="artwork"><rect x="1" y="1" width="4" height="4"/><rect x="10" y="1" width="4" height="4"/></g>',
      '</svg>'
    ].join('\n'))
    const inspected = (await createDesignSvgInspectTool().execute({}, context(workspace))).output as {
      revision: string
      elements: Array<{ tag: string; handle: string }>
    }
    const rects = inspected.elements.filter((element) => element.tag === 'rect')
    const edited = await createDesignSvgEditTool().execute({
      expectedRevision: inspected.revision,
      ops: [
        { op: 'delete', handle: rects[0].handle },
        { op: 'update', handle: rects[1].handle, attributes: { id: 'second-rect', fill: '#123456' } }
      ]
    }, context(workspace))
    expect(edited.isError).toBeUndefined()
    const source = await readFile(join(workspace, relativePath), 'utf8')
    expect((source.match(/<rect/g) ?? [])).toHaveLength(1)
    expect(source).toContain('id="second-rect"')
    expect(source).toContain('x="10"')

    const staleHandle = rects[1].handle
    const externalSource = source.replace('<g id="artwork">', '<g id="artwork"><circle id="external" cx="2" cy="2" r="1"/>')
    await writeFile(join(workspace, relativePath), externalSource, 'utf8')
    const stale = await createDesignSvgEditTool().execute({
      expectedRevision: inspected.revision,
      ops: [{ op: 'update', handle: staleHandle, attributes: { fill: 'red' } }]
    }, context(workspace))
    expect(stale.isError).toBe(true)
    expect(JSON.stringify(stale.output)).toContain('revision conflict')
    expect(await readFile(join(workspace, relativePath), 'utf8')).toBe(externalSource)
  })

  it('rejects ambiguous duplicate-id targets and repairs them through revision-bound handles', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">Duplicates</title><desc id="desc">Imported duplicate ids.</desc>',
      '<g id="artwork"><rect id="duplicate" width="4" height="4"/><rect id="duplicate" x="8" width="4" height="4"/></g>',
      '</svg>'
    ].join(''))
    const ambiguous = await createDesignSvgEditTool().execute({
      ops: [{ op: 'update', id: 'duplicate', attributes: { fill: 'red' } }]
    }, context(workspace))
    expect(ambiguous.isError).toBe(true)
    expect(JSON.stringify(ambiguous.output)).toContain('ambiguous')

    const inspected = (await createDesignSvgInspectTool().execute({}, context(workspace))).output as {
      revision: string
      elements: Array<{ id: string | null; handle: string }>
    }
    const duplicates = inspected.elements.filter((element) => element.id === 'duplicate')
    const repaired = await createDesignSvgEditTool().execute({
      expectedRevision: inspected.revision,
      ops: [{ op: 'update', handle: duplicates[1].handle, attributes: { id: 'duplicate-2' } }]
    }, context(workspace))
    expect(repaired.isError).toBeUndefined()
    expect(await readFile(join(workspace, relativePath), 'utf8')).toContain('id="duplicate-2"')
  })

  it('bounds nested and oversized add specs before constructing the DOM tree', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const nestedSpec = (levels: number): Record<string, unknown> => {
      let value: Record<string, unknown> = { tag: 'rect', attributes: { width: 1, height: 1 } }
      for (let index = 1; index < levels; index += 1) {
        value = { tag: 'g', children: [value] }
      }
      return value
    }
    const atLimit = await createDesignSvgEditTool().execute({
      ops: [{ op: 'add', parentId: 'artwork', element: nestedSpec(DESIGN_SVG_EDIT_MAX_ELEMENT_DEPTH) }]
    }, context(workspace))
    expect(atLimit.isError).toBeUndefined()
    const afterAccepted = await readFile(absolutePath, 'utf8')

    const tooDeep = await createDesignSvgEditTool().execute({
      ops: [{ op: 'add', parentId: 'artwork', element: nestedSpec(DESIGN_SVG_EDIT_MAX_ELEMENT_DEPTH + 1) }]
    }, context(workspace))
    const tooMany = await createDesignSvgEditTool().execute({
      ops: [{
        op: 'add',
        parentId: 'artwork',
        element: {
          tag: 'g',
          children: Array.from({ length: DESIGN_SVG_EDIT_MAX_ELEMENTS }, () => ({ tag: 'rect', attributes: { width: 1, height: 1 } }))
        }
      }]
    }, context(workspace))
    expect(tooDeep.isError).toBe(true)
    expect(JSON.stringify(tooDeep.output)).toContain(`${DESIGN_SVG_EDIT_MAX_ELEMENT_DEPTH} levels`)
    expect(tooMany.isError).toBe(true)
    expect(JSON.stringify(tooMany.output)).toContain(`more than ${DESIGN_SVG_EDIT_MAX_ELEMENTS} elements`)
    expect(JSON.stringify(tooMany.output)).toContain('design_svg_inspect again')
    expect(await readFile(absolutePath, 'utf8')).toBe(afterAccepted)
  })

  it('does not overwrite an external edit that lands between read and commit', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '  <title id="title">Conflict</title><desc id="desc">Concurrent editor.</desc>',
      '  <g id="artwork"><rect id="tile" width="10" height="10" /></g>',
      '</svg>'
    ].join('\n'))
    const absolutePath = join(workspace, relativePath)
    const externalSource = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">External</title><desc id="desc">External edit wins.</desc>',
      '<g id="artwork"><circle id="external" cx="5" cy="5" r="4" /></g></svg>'
    ].join('')
    const inspect = (await createDesignSvgInspectTool().execute({}, context(workspace))).output as { revision: string }
    const edit = await createDesignSvgEditTool({
      beforeCommit: async (path) => writeFile(path, externalSource, 'utf8')
    }).execute({
      expectedRevision: inspect.revision,
      ops: [{ op: 'update', id: 'tile', attributes: { fill: 'red' } }]
    }, context(workspace))
    expect(edit.isError).toBe(true)
    expect(JSON.stringify(edit.output)).toContain('changed before write')
    expect(await readFile(absolutePath, 'utf8')).toBe(externalSource)

    await writeFile(absolutePath, [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">Animate conflict</title><desc id="desc">Animation editor.</desc>',
      '<g id="artwork"><rect id="tile" width="10" height="10" /></g></svg>'
    ].join(''), 'utf8')
    const animateInspect = (await createDesignSvgInspectTool().execute({}, context(workspace))).output as { revision: string }
    const animate = await createDesignSvgAnimateTool({
      beforeCommit: async (path) => writeFile(path, externalSource, 'utf8')
    }).execute({
      expectedRevision: animateInspect.revision,
      animations: [{ targetId: 'tile', kind: 'attribute', attributeName: 'opacity', values: [0, 1] }]
    }, context(workspace))
    expect(animate.isError).toBe(true)
    expect(JSON.stringify(animate.output)).toContain('changed before write')
    expect(await readFile(absolutePath, 'utf8')).toBe(externalSource)
  })

  it('rejects reparenting an element into its own descendant without changing the file', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
      '  <title id="title">Groups</title><desc id="desc">Nested groups.</desc>',
      '  <g id="artwork"><g id="outer"><g id="inner" /></g></g>',
      '</svg>'
    ].join('\n'))
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const result = await createDesignSvgEditTool().execute({
      ops: [{ op: 'reparent', id: 'outer', parentId: 'inner' }]
    }, context(workspace))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false, error: expect.stringContaining('descendant') })
    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })

  it('rejects namespace declaration changes through update removals', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const viaNull = await createDesignSvgEditTool().execute({
      ops: [{ op: 'update', id: 'artwork', attributes: { xmlns: null } }]
    }, context(workspace))
    const viaList = await createDesignSvgEditTool().execute({
      ops: [{ op: 'update', id: 'artwork', removeAttributes: ['xmlns:xlink'] }]
    }, context(workspace))
    expect(viaNull.isError).toBe(true)
    expect(viaList.isError).toBe(true)
    expect(JSON.stringify(viaNull.output)).toContain('namespace declarations')
    expect(JSON.stringify(viaList.output)).toContain('namespace declarations')
    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })

  it('enforces the workspace boundary for reserved SVG paths even in full-access mode', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-design-svg-boundary-'))
    const outside = await mkdtemp(join(tmpdir(), 'kun-design-svg-outside-'))
    workspaces.push(workspace, outside)
    await mkdir(join(workspace, '.kun-design/doc'), { recursive: true })
    await writeFile(join(outside, 'v1.svg'), [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '<title id="title">Outside</title><desc id="desc">Must not change.</desc><g id="artwork" />',
      '</svg>'
    ].join(''), 'utf8')
    await symlink(outside, join(workspace, '.kun-design/doc/artifact'))
    const fullAccess = { ...context(workspace), sandboxMode: 'danger-full-access' as const }
    const result = await createDesignSvgEditTool().execute({
      ops: [{ op: 'add', parentId: 'artwork', element: { tag: 'rect', id: 'escaped', attributes: { width: 2, height: 2 } } }]
    }, fullAccess)
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false, error: expect.stringContaining('workspace root') })
    expect(await readFile(join(outside, 'v1.svg'), 'utf8')).not.toContain('escaped')
  })

  it('reports foreign namespaces and malformed SMIL timing or motion data', async () => {
    const workspace = await workspaceWithSvg([
      '<x:svg xmlns:x="urn:not-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '  <title id="title">Bad motion</title><desc id="desc">Invalid imported animation.</desc>',
      '  <path id="orbit" d="M0 0 L10 10">',
      '    <animateMotion id="bad-motion" path="not a path" dur="banana" begin="after lunch" repeatCount="-5" />',
      '  </path>',
      '</x:svg>'
    ].join('\n'))
    const result = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(result.isError).toBe(true)
    const serialized = JSON.stringify(result.output)
    expect(serialized).toContain('invalid-element-namespace')
    expect(serialized).toContain('invalid-animation-duration')
    expect(serialized).toContain('invalid-animation-begin')
    expect(serialized).toContain('invalid-animation-repeat')
    expect(serialized).toContain('invalid-motion-path')
  })

  it('accepts common SMIL begin clocks, events, and syncbase timing', async () => {
    const workspace = await workspaceWithSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
      '  <title id="title">Timing</title><desc id="desc">Supported SMIL begin forms.</desc>',
      '  <g id="artwork"><circle id="dot" cx="5" cy="5" r="2">',
      '    <animate id="pulse" attributeName="opacity" values="0;1" dur="1s" begin="-250ms;click+1s;dot.mouseover-0.5s;other.end+2s;pulse.repeat(2);indefinite" />',
      '  </circle></g>',
      '</svg>'
    ].join('\n'))
    const result = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.output)).not.toContain('invalid-animation-begin')
  })

  it('repairs a missing standalone namespace and validates the serialized result', async () => {
    const workspace = await workspaceWithSvg([
      '<svg viewBox="0 0 20 20">',
      '  <title id="title">Imported</title><desc id="desc">Missing namespace.</desc>',
      '  <g id="artwork"><rect id="tile" width="10" height="10" /></g>',
      '</svg>'
    ].join('\n'))
    const edited = await createDesignSvgEditTool().execute({
      ops: [{ op: 'set-document', attributes: { xmlns: 'http://www.w3.org/2000/svg' } }]
    }, context(workspace))
    expect(edited.isError).toBeUndefined()
    expect(await readFile(join(workspace, relativePath), 'utf8')).toContain('xmlns="http://www.w3.org/2000/svg"')
    const validated = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(validated.isError).toBe(false)
  })

  it('rejects a mutation whose serialized result exceeds the SVG source limit', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const result = await createDesignSvgEditTool().execute({
      ops: [{
        op: 'add',
        parentId: 'artwork',
        element: { tag: 'metadata', id: 'oversized', text: 'x'.repeat(1_000_001) }
      }]
    }, context(workspace))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false, error: expect.stringContaining('1000000 bytes') })
    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })
})
