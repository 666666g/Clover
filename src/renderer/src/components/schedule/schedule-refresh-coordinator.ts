export type ScheduleRefreshCoordinator = {
  beginRefresh: () => number | null
  beginMutation: () => number
  endMutation: () => void
  isCurrent: (ticket: number) => boolean
  invalidate: () => void
}

/** Prevents slow polling responses from overwriting newer saves or unmounted state. */
export function createScheduleRefreshCoordinator(): ScheduleRefreshCoordinator {
  let version = 0
  let activeMutations = 0
  return {
    beginRefresh: () => activeMutations > 0 ? null : ++version,
    beginMutation: () => {
      activeMutations += 1
      return ++version
    },
    endMutation: () => {
      activeMutations = Math.max(0, activeMutations - 1)
    },
    isCurrent: (ticket) => ticket === version,
    invalidate: () => { version += 1 }
  }
}
