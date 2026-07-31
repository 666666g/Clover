import { describe, expect, it } from 'vitest'
import { parseExtensionNotificationSnapshot } from './ExtensionWorkbenchLifecycle'

describe('extension workbench notification lifecycle', () => {
  it('accepts bounded runtime notifications, deduplicates IDs, and rejects malformed identity', () => {
    const valid = {
      notificationId: 'notification_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      sourceId: 'provider-warning',
      title: 'Provider unavailable',
      message: 'Reconnect the account and retry.',
      severity: 'warning',
      actions: [{ id: 'retry', title: 'Retry' }],
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:01:00.000Z'
    }
    const notifications = parseExtensionNotificationSnapshot({
      notifications: [
        valid,
        { ...valid, title: 'Latest bounded snapshot' },
        { ...valid, notificationId: '../spoofed', extensionId: 'other.extension' },
        { ...valid, notificationId: 'notification_22345678-1234-1234-1234-123456789abc', extensionId: '../bad' },
        { ...valid, notificationId: 'notification_32345678-1234-1234-1234-123456789abc', actions: [{ id: 'x', title: 'x', command: 'steal' }] }
      ]
    })

    expect(notifications).toEqual([expect.objectContaining({
      notificationId: valid.notificationId,
      extensionId: 'acme.dashboard',
      title: 'Latest bounded snapshot',
      actions: [{ id: 'retry', title: 'Retry' }]
    })])
  })

  it('rejects invalid time bounds and non-array snapshots', () => {
    expect(parseExtensionNotificationSnapshot({ notifications: [{
      notificationId: 'notification_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      sourceId: 'notice',
      title: 'Notice',
      message: 'Message',
      severity: 'info',
      actions: [],
      createdAt: '2026-07-11T00:01:00.000Z',
      expiresAt: '2026-07-11T00:00:00.000Z'
    }] })).toEqual([])
    expect(parseExtensionNotificationSnapshot({ notifications: 'not-an-array' })).toEqual([])
  })
})
