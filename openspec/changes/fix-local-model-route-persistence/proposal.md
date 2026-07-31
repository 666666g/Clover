## Why

Current-version local relay settings are passed through the legacy settings migrator on every application start. That migration rebuilds provider settings without route pools or local gateway state, so valid persisted routes disappear from memory and Kun starts with an empty routing configuration; later saves can then overwrite the surviving disk data.

## What Changes

- Preserve current route pools, local gateway state, and multi-account provider metadata across startup normalization and unrelated settings saves.
- Retain structurally valid route targets whose provider or model is temporarily missing, while excluding them from the Runtime projection until the reference becomes valid again.
- Keep saved routing intent when Runtime hot apply, restart, or synchronization is unavailable instead of rolling it back as if it were process-critical configuration.
- Show separate local-save and Runtime-synchronization states in the Advanced Local Relay workspace, including actionable disabled reasons for complete-chain testing.
- Report the Runtime's effective local gateway state together with its effective route pools.

## Capabilities

### New Capabilities

- `local-model-route-persistence`: Durable storage, reference preservation, Runtime projection, synchronization visibility, and recovery behavior for local model routes.

### Modified Capabilities

None.

## Impact

- Settings loading, migration, patch merging, IPC validation, and Runtime rollback behavior in the Electron main/shared layers.
- Route-pool projection and status contracts shared by startup, hot apply, model selectors, and the Kun Runtime.
- Advanced Local Relay settings UI and its chain-test readiness logic.
- Settings, Runtime configuration, route status, and renderer component tests.
