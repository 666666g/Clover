import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedExtensionView } from './extension-descriptor-resolver'
import { KUN_EXTENSION_CSP } from './extension-resource-protocol'
import { ExtensionViewProtocolRegistry } from './extension-view-protocol-registry'
import { ExtensionViewSessionRegistry } from './extension-view-sessions'

const roots: string[] = []

async function viewFixture(): Promise<ResolvedExtensionView> {
  const packageRoot = await mkdtemp(join(tmpdir(), 'kun-extension-view-protocol-'))
  roots.push(packageRoot)
  await mkdir(join(packageRoot, 'dist', 'assets'), { recursive: true })
  await writeFile(join(packageRoot, 'dist', 'index.html'), '<p id="marker">isolated view</p>')
  await writeFile(join(packageRoot, 'dist', 'assets', 'app.js'), 'export {}')
  return {
    extensionId: 'acme.example',
    extensionVersion: '1.0.0',
    packageRoot,
    contributionId: 'issues',
    entry: 'dist/index.html',
    localResourceRoots: ['dist/assets']
  } as ResolvedExtensionView
}

function sessionRecord(sessionId = '1234567890abcdef') {
  return new ExtensionViewSessionRegistry().create({
    sessionId,
    extensionId: 'acme.example',
    extensionVersion: '1.0.0',
    contributionId: 'extension:acme.example/issues',
    entryPath: 'dist/index.html',
    parentWebContentsId: 10
  })
}

function protocolFixture() {
  let handler: ((request: Request) => Response | Promise<Response>) | undefined
  const protocol = {
    unhandle: vi.fn(),
    handle: vi.fn((_scheme: string, next: typeof handler) => {
      handler = next
    })
  }
  return { protocol, getHandler: () => handler }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExtensionViewProtocolRegistry', () => {
  it('serves the first navigation from the exact isolated partition', async () => {
    const view = await viewFixture()
    const record = sessionRecord()
    const target = protocolFixture()
    const protocolForPartition = vi.fn(() => target.protocol)
    const denied = vi.fn()
    const registry = new ExtensionViewProtocolRegistry(protocolForPartition, denied)

    registry.prepare(record, view)

    expect(protocolForPartition).toHaveBeenCalledWith(record.partition)
    expect(target.protocol.unhandle).toHaveBeenCalledWith('kun-extension')
    expect(target.protocol.handle).toHaveBeenCalledWith('kun-extension', expect.any(Function))
    registry.assertPrepared(record)
    expect(registry.isPreparedInitialNavigation(target.protocol, record.sourceUrl)).toBe(true)
    expect(registry.isPreparedInitialNavigation(
      target.protocol,
      'kun-extension://acme.example/dist/assets/app.js?kunViewSession=1234567890abcdef'
    )).toBe(false)

    const response = await target.getHandler()!(new Request(record.sourceUrl))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('isolated view')
    expect(response.headers.get('content-security-policy')).toBe(KUN_EXTENSION_CSP)

    const deniedResponse = await target.getHandler()!(
      new Request('kun-extension://other.example/dist/index.html')
    )
    expect(deniedResponse.status).toBe(404)
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'other.example',
      code: 'EXTENSION_NOT_AVAILABLE',
      sessionId: record.sessionId
    }))
  })

  it('pins the View entry and resource roots instead of exposing other contributions', async () => {
    const view = await viewFixture()
    const record = sessionRecord()
    await writeFile(join(view.packageRoot, 'dist', 'other.html'), '<p>other view</p>')
    const target = protocolFixture()
    const registry = new ExtensionViewProtocolRegistry(() => target.protocol)
    registry.prepare(record, view)

    await expect(target.getHandler()!(
      new Request('kun-extension://acme.example/dist/assets/app.js')
    )).resolves.toMatchObject({ status: 200 })
    await expect(target.getHandler()!(
      new Request('kun-extension://acme.example/dist/other.html')
    )).resolves.toMatchObject({ status: 404 })
  })

  it('unhandles only the disposed partition and makes repeated disposal harmless', async () => {
    const view = await viewFixture()
    const first = sessionRecord('1234567890abcdef')
    const second = sessionRecord('fedcba0987654321')
    const targets = new Map([
      [first.partition, protocolFixture()],
      [second.partition, protocolFixture()]
    ])
    const registry = new ExtensionViewProtocolRegistry((partition) => targets.get(partition)!.protocol)
    registry.prepare(first, view)
    registry.prepare(second, view)

    expect(registry.dispose(first.sessionId)).toBe(true)
    expect(registry.dispose(first.sessionId)).toBe(false)
    expect(targets.get(first.partition)!.protocol.unhandle).toHaveBeenCalledTimes(2)
    expect(targets.get(second.partition)!.protocol.unhandle).toHaveBeenCalledTimes(1)

    registry.disposeAll()
    expect(targets.get(second.partition)!.protocol.unhandle).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed synchronous protocol installation and permits retry', async () => {
    const view = await viewFixture()
    const record = sessionRecord()
    const target = protocolFixture()
    target.protocol.handle.mockImplementationOnce(() => {
      throw new Error('protocol unavailable')
    })
    const registry = new ExtensionViewProtocolRegistry(() => target.protocol)

    expect(() => registry.prepare(record, view)).toThrow(/protocol unavailable/)
    expect(() => registry.assertPrepared(record)).toThrow(/not prepared/)
    expect(() => registry.prepare(record, view)).not.toThrow()
    registry.assertPrepared(record)
  })
})
