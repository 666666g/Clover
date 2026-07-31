export type ProtectedSurfaceRestoreTarget = 'settings' | 'initial-setup'

const PROTECTED_SURFACE_RESTORE_KEY = 'kun:protected-surface-restore'

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readProtectedSurfaceRestore(
  storage: SessionStorageLike | undefined = browserSessionStorage()
): ProtectedSurfaceRestoreTarget | undefined {
  try {
    const value = storage?.getItem(PROTECTED_SURFACE_RESTORE_KEY)
    return value === 'settings' || value === 'initial-setup' ? value : undefined
  } catch {
    return undefined
  }
}

export function markProtectedSurfaceRestore(
  target: ProtectedSurfaceRestoreTarget,
  storage: SessionStorageLike | undefined = browserSessionStorage()
): void {
  try {
    storage?.setItem(PROTECTED_SURFACE_RESTORE_KEY, target)
  } catch {
    // The gate still fails closed if session storage is unavailable; only
    // automatic route restoration after the clean reload is lost.
  }
}

export function clearProtectedSurfaceRestore(
  target: ProtectedSurfaceRestoreTarget,
  storage: SessionStorageLike | undefined = browserSessionStorage()
): void {
  try {
    if (storage?.getItem(PROTECTED_SURFACE_RESTORE_KEY) === target) {
      storage.removeItem(PROTECTED_SURFACE_RESTORE_KEY)
    }
  } catch {
    // Ignore storage teardown errors.
  }
}

function browserSessionStorage(): SessionStorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}
