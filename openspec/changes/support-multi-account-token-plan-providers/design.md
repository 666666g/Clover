## Context

Provider presets currently use their preset id as the persisted provider id. The add flow therefore interprets a second selection of the same preset as an update, which makes one preset incapable of representing two subscription credentials. Several downstream helpers also recognize presets exclusively from an exact provider id or the legacy `<preset>-token-plan` suffix, so a numeric id alone would silently lose capability backfill, validation, grouping, and badges.

Kun already treats provider ids as the concrete routing and credential boundary. Once every account has a stable unique provider id, the runtime provider map, protected credential source, model selectors, workflows, schedules, and local model route targets can distinguish the accounts without a second runtime or a new request protocol.

## Goals / Non-Goals

**Goals:**

- Allow repeated creation of accounts from every subscription preset and nested Token Plan mode.
- Generate predictable unique ids and names with monotonically increasing numeric suffixes.
- Preserve preset behavior for every duplicate across saves and application restarts.
- Keep credentials, health, selection, usage attribution, and route targets isolated by account id.
- Preserve current singleton update behavior for pay-as-you-go presets.

**Non-Goals:**

- Automatically load-balance accounts without an explicit local route pool.
- Merge quotas, discover account balances, rotate credentials inside one provider profile, or nest provider profiles.
- Rewrite existing provider ids or names merely to add source metadata.

## Decisions

### Persist an explicit preset source on each profile

`ModelProviderProfileV1` gains optional `presetSource: { presetId, mode }` metadata. Preset factories populate it for both direct and Token Plan modes, and normalization validates it against the built-in catalog. Existing exact-id profiles infer the same metadata during normalization, so no eager migration is required.

This is preferred over parsing arbitrary numeric id suffixes because users and future migrations may change ids, while preset capabilities and access mode must remain stable. Invalid or removed sources are ignored rather than granting preset behavior to unknown data.

### Subscription presets create accounts; API presets keep update semantics

A preset is multi-account eligible when its direct preset category is `subscription` or the selected mode is `token-plan`. Re-selecting such an entry always creates a local draft for a new account. Direct pay-as-you-go entries retain the existing confirm-and-refresh behavior so users do not accidentally duplicate ordinary API configurations when they intend to update shipped models or endpoints.

### Allocate the next ordinal from the whole preset account family

The first account keeps the canonical preset id and display name. Later accounts use `<base-id>-N` and `<base-name> N`, where `N` is one greater than the highest existing ordinal for the same `{presetId, mode}` family. The allocator also advances past unrelated id or case-insensitive name collisions. Deleting account 2 does not cause the next account to reuse 2 while account 3 exists.

Both id and name are assigned before the draft is shown. Users may edit the display name, while the provider id remains locked for any validated preset source.

### Reuse provider ids as the isolation boundary

Each account remains a normal concrete provider profile with its own API key. Existing runtime projection and secure credential migration already key entries by provider id, so unique ids yield independent upstream clients without protocol changes. Model selectors and route-target selectors continue to show the provider display name and carry the unique provider id; a route pool is the explicit mechanism for combining capacity across accounts.

Preset capability/model backfill, Token Plan regional endpoints, API-key requirements, subscription grouping, badges, and MiniMax media defaults resolve through `presetSource` with legacy-id inference as fallback.

### Show account multiplicity at creation time

The provider-add dialog reports the number of configured accounts for a subscription entry and labels the action as adding another account. This replaces the misleading “Update preset” state for plans. Pay-as-you-go entries continue to show the update state when their canonical profile already exists.

## Risks / Trade-offs

- [Preset metadata becomes part of persisted settings] → Validate it against built-in presets and infer it only for exact legacy ids.
- [A user-created provider could collide with a generated id or name] → Check all configured profiles and increment until both are unique.
- [Two accounts expose identical model ids] → Keep provider grouping and provider ids visible; model requests already carry the selected provider id, and shared model capability aggregation remains unchanged.
- [Removing a built-in preset in a future release leaves source metadata behind] → Normalize the profile as a custom provider while retaining its explicit endpoint, models, and credentials.

## Migration Plan

1. Normalize existing canonical preset profiles with inferred `presetSource` in memory and persist it on the next settings save.
2. New duplicate accounts are written with explicit metadata and unique ids/names.
3. Runtime hot apply adds each unique provider and credential source independently.
4. Rollback ignores the extra metadata; duplicate profiles still function as explicit custom-compatible providers, though preset backfill and plan badges would be unavailable.

## Open Questions

None. Multi-account creation is limited to subscription/Token Plan entries, numbering is monotonic within each preset/mode family, and pooling remains an explicit route configuration.
