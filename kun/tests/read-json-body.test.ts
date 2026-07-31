import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES, readJsonBody } from '../src/server/read-json-body.js'

describe('readJsonBody', () => {
  it('uses a small default limit for control-plane JSON', () => {
    expect(DEFAULT_MAX_JSON_BODY_BYTES).toBe(1 * 1024 * 1024)
  })

  it('returns an empty object for requests without a body', async () => {
    await expect(readJsonBody(new Request('http://localhost/v1/demo'))).resolves.toEqual({
      ok: true,
      value: {}
    })
  })

  it('parses valid JSON bodies', async () => {
    await expect(
      readJsonBody(new Request('http://localhost/v1/demo', {
        method: 'POST',
        body: JSON.stringify({ ok: true })
      }))
    ).resolves.toEqual({
      ok: true,
      value: { ok: true }
    })
  })

  it('returns a structured 400 response for invalid JSON bodies', async () => {
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      body: '{'
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    expect(JSON.parse(result.response.body)).toMatchObject({
      code: 'validation_error',
      message: 'invalid JSON body'
    })
  })

  it('rejects a declared body that exceeds the configured byte limit', async () => {
    let cancelled = false
    let pulled = false
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true
      },
      cancel() {
        cancelled = true
      }
    })
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      headers: { 'content-length': '128' },
      body,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' }), 32)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
    expect(pulled).toBe(false)
    expect(cancelled).toBe(true)
  })

  it('rejects a streamed body that exceeds the configured byte limit', async () => {
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      body: JSON.stringify({ text: 'x'.repeat(128) })
    }), 32)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
  })
})
