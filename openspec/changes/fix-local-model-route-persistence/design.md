## Context

`kun-settings.json` is the authoritative application settings file and Kun's generated `config.json` is a derived Runtime projection. The settings store currently passes every parsed document through `migrateLegacyAppSettings`, which reconstructs the provider object without newer route and account fields. Separately, route normalization deletes targets when their referenced provider or model is temporarily unavailable, and Runtime restart rollback restores the whole previous provider object. These behaviors can destroy valid user intent even though atomic file writing works correctly.

The fix crosses shared settings contracts, Electron settings storage and hot apply, Kun route status, and the renderer route editor. It must preserve the single Kun Runtime architecture and existing local OpenAI-compatible endpoints.

## Goals / Non-Goals

**Goals:**

- Make current and legacy settings normalization lossless for route and multi-account fields.
- Separate durable desired route configuration from the executable Runtime projection.
- Preserve repairable dangling references and make their status visible.
- Distinguish disk persistence from Runtime synchronization and make chain-test readiness deterministic.

**Non-Goals:**

- Adding a second routing settings file, historical snapshot service, or new settings version.
- Allowing nested route pools or changing routing algorithms and failure classification.
- Persisting Runtime circuit state or chain-test execution state in application settings.

## Decisions

### Use one conditional normalization path

The settings store will stop invoking the legacy migrator unconditionally. Current documents will pass directly through the normal current-version normalizer; only documents matching the existing legacy predicate will migrate. The legacy migrator will also spread and normalize the complete provider object before applying legacy credential fallbacks so known current extensions survive defensive or mixed-version migrations.

This is preferred over adding fields to only the current migration call because future provider extensions would otherwise be vulnerable to the same omission.

### Preserve desired targets and derive reference status

Persisted route normalization will validate identifiers, bounds, duplicates, policies, and weights without requiring referenced providers or models to exist. A shared resolver will classify targets as `valid`, `provider-missing`, or `model-missing`. A separate executable projection will retain pool identity and policy, filter invalid targets, and force only the projected pool to disabled when it has no valid enabled targets.

Startup configuration, hot apply, model catalog construction, Runtime comparison, and chain-test readiness will use this projection. The UI will use the resolver to render repair options while keeping the persisted target unchanged.

### Keep route intent across Runtime rollback

Settings remain atomically persisted before the existing asynchronous Runtime apply. If process-critical settings require rollback, the rollback merge will preserve the newest `routePools` and `localGateway` rather than restoring those fields from the old provider snapshot. A route-only apply failure will be reported as unsynchronized and will not rewrite desired routing settings.

### Compare effective configuration and report apply state

`GET /v1/model-routes` will add the effective local gateway enabled state while retaining existing fields. The renderer will compare the full saved executable projection with the returned Runtime pools and gateway state. Save status comes from the existing settings persistence pipeline; Runtime state comes from authenticated status polling. A chain test is enabled only when persistence is complete, the selected pool is executable, and the effective configurations match.

The Electron main process will additionally publish a non-persistent settings-sync state over IPC. A configuration mismatch remains pending for any duration; only an explicit failed apply/restart result may be presented as synchronization failure. Runtime status remains authoritative for what is actually active, while the main-process state explains whether the latest background apply is queued, complete, unavailable, or failed.

### Coalesce automatic-save Runtime applies

Settings are saved independently and may arrive faster than Kun can hot-apply them. The managed Runtime operation coordinator will run at most one apply and retain only the newest pending apply. Intermediate pending snapshots are replaced, while the latest desired settings anchor is preserved. Sync-state generations prevent completion or failure from an older in-flight apply from overwriting the state of a newer edit.

## Risks / Trade-offs

- [A dangling target can remain stored indefinitely] → Render a prominent invalid-reference state with replace and delete actions; never expose it in executable model lists.
- [Runtime comparison can be sensitive to ordering] → Compare a canonical projection with stable field ordering while preserving target order because priority routing depends on it.
- [A slow apply can look indistinguishable from a failed apply] → Keep mismatched configurations pending until the main process reports an explicit failure; do not infer failure from an elapsed UI timer.
- [Rapid field edits can enqueue redundant hot applies] → Coalesce pending applies to the newest snapshot and ignore stale sync-state completions by generation.
- [A mixed settings save can roll back provider transport but retain route references to the rejected provider state] → Preserve the routes as invalid, visible repairable intent rather than deleting them.
- [The existing settings file could be overwritten by a still-running affected build] → Create one permission-preserving pre-fix backup before implementation and do not use it as a second source of truth.

## Migration Plan

1. Preserve the current local settings file in a one-time external backup before running an affected build again.
2. Ship lossless loading and reference-preserving normalization without changing the settings version.
3. On first fixed startup, load the existing current file, regenerate the Kun config from the executable projection, and surface the restored routes automatically.
4. If rollback is needed, revert the code; the on-disk schema remains compatible and the one-time backup can recover the pre-fix local state manually.

## Open Questions

None.
