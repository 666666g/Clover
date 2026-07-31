## 1. Settings Durability

- [x] 1.1 Make settings-store loading use conditional current/legacy normalization and preserve current provider extensions during legacy migration
- [x] 1.2 Add settings-store restart, unrelated-patch, and mixed legacy/current round-trip coverage
- [x] 1.3 Extend strict provider IPC validation and tests for multi-account `presetSource`

## 2. Route Reference Projection

- [x] 2.1 Preserve structurally valid dangling route targets and expose shared reference-resolution statuses
- [x] 2.2 Add a shared executable route projection and use it for startup/hot-apply and routed model catalogs
- [x] 2.3 Preserve newest route pools and local gateway intent during Runtime apply rollback

## 3. Runtime Status And UI

- [x] 3.1 Return effective local gateway state from the authenticated route status endpoint
- [x] 3.2 Show distinct local-save and Runtime-sync states with retry behavior in Advanced Local Relay
- [x] 3.3 Render missing provider/model targets as repairable entries and gate chain tests on the executable synchronized projection

## 4. Validation And Delivery

- [x] 4.1 Add Runtime projection/status and route-editor interaction tests covering stopped, pending, synchronized, and invalid-reference states
- [x] 4.2 Run relevant Vitest suites, typecheck, Kun build, and top-level build
- [x] 4.3 Verify a close/reload persistence smoke flow, complete the OpenSpec checklist, and create the requested local commit

## 5. Follow-up Runtime Synchronization Fix

- [x] 5.1 Coalesce consecutive pending settings applies so only the latest saved Runtime projection remains queued
- [x] 5.2 Expose non-persistent main-process Runtime settings-sync state through typed IPC with stale-generation protection
- [x] 5.3 Remove elapsed-time failure inference from the route UI and show explicit pending, unavailable, synchronized, and failed states
- [x] 5.4 Add queue, IPC, and renderer regression coverage and rerun the relevant validation matrix
