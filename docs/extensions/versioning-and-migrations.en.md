# Versioning, Compatibility, and State Migration

> Extension API: v1
> 中文：[版本、兼容与状态迁移](./versioning-and-migrations.md)
> Related: [Manifest version fields](./manifest.en.md#version-fields) · [Packaging and rollback](./packaging-and-index.en.md#enable-disable-rollback-and-uninstall)

Kun versions packages, Manifest, public API, Kun engine, Host RPC, and extension state separately. Each dimension solves a different problem and cannot substitute for another.

## Six version dimensions

| Dimension | Declared in | Type | Responsibility |
| --- | --- | --- | --- |
| Extension package `version` | Manifest | SemVer | Extension release and immutable install directory |
| `manifestVersion` | Manifest | Integer `1` in v1 | Manifest structure/security semantics |
| `apiVersion` | Manifest | SemVer | Third-party public SDK/Host contract |
| `engines.kun` | Manifest | SemVer range | Compatible Kun product versions |
| `stateSchemaVersion` | Manifest | Non-negative integer (start new extensions at 1) | Global/workspace state shape |
| `rpcVersion` | Kun ↔ bundled Host | Private negotiated value | Internal wire protocol within a Kun release |

Changing one dimension does not change another. A compatibility error identifies the exact declared/supported dimension.

`rpcVersion` is not a third-party API. It is absent from the Manifest and extensions neither import nor send it directly. Kun may change internal wire format while public adapters preserve commitments.

## Public API SemVer

All public symbols and documented behavior in `@kun/extension-api`, `@kun/extension-react`, `@kun/extension-test`, and Manifest/wire contracts are stable from publication:

- Patch: defect fixes without public type/behavior breakage.
- Minor: backwards-compatible optional capability/field/method/event additions only.
- Major: breaking changes with migration guidance.

Kun has no `experimental` namespace that bypasses this promise. A private path does not become stable merely because TypeScript can import it.

An extension targeting an older minor in the same major continues to run. It tolerates newly added optional fields and checks negotiated capabilities before calling a new optional API.

## Compatibility matrix

Kun supports current Extension API major `N` and previous `N-1` when `N > 1`:

| Current API major | Required support | Rejected before code executes |
| --- | --- | --- |
| 1 | 1 | Future major and every non-1 major |
| 2 | 1 and 2 | 3+; no other older major exists |
| 3 | 2 and 3 | 1 and 4+ |
| N | N-1 and N | ≤N-2 and ≥N+1 |

“Support” includes public behavior and Host adapters, not merely accepting a Manifest. Previous-major and current-major extensions can activate together using their respective negotiated contracts.

The release gate counts only executed behavioral conformance as support evidence. API v1 has no previous major, so it executes current-v1 clean-project conformance only. When current becomes v2 or later, declaring the support window does not release the build. Kun must retain the previous-major SDK at `packages/extension-api-compat/v<N-1>` and provide `scripts/fixtures/extension-api-conformance/v<N-1>.mjs` to run old View/Agent/tool/Provider behavior from the packaged SDK against the current Host adapter. A missing artifact or runner fails closed.

A versioned compatibility artifact documents concrete Kun release ↔ API/Manifest/SDK coordinates. Use `engines.kun` for the range actually tested; do not publish an unbounded `*`.

## Admission and capability negotiation

Execution order:

1. validate archive, identity, package SemVer, Manifest Schema, entries;
2. ensure running Kun satisfies `engines.kun`;
3. validate `manifestVersion`;
4. ensure `apiVersion` major is in the support window;
5. negotiate available minor capabilities and private `rpcVersion`;
6. validate required contribution capabilities, permissions, workspace policy;
7. transactionally migrate state when required;
8. only then load Node entry, Webview, or content script.

An absent optional capability is exposed as unavailable or structured unsupported-capability. A missing required capability fails closed before contribution registration/code execution. Payloads cannot raise negotiated API or grants after connection.

`kun extension doctor <id>` shows declared/negotiated/result for Manifest, API, engine, RPC, and state without secrets.

## Deprecation policy

Before removing a public API, Kun:

1. marks it deprecated;
2. documents a replacement in docs/types/validator/development logs;
3. names the earliest removal major;
4. keeps it functional for at least one complete API-major transition;
5. removes only in a later new major.

For example, an API deprecated in v1 remains functional while v2 supports v1/v2. v3 is the earliest removal point, when v1 leaves the support window. Changelog, migration guide, diagnostics, and types remain aligned.

Migrate in the same release cycle that produces a warning; do not wait for removal.

## State Schema migration

`stateSchemaVersion` describes extension state only and does not rise automatically with package/API. Increase it only when persisted state shape needs migration.

On a genuinely fresh install with no retained state file, Kun creates empty namespaces at the package's declared `stateSchemaVersion` and does not invoke migration. Reinstalling an extension whose state was preserved is not fresh: compatibility or migration uses the actual committed schema.

When a selected package declares a higher state version than committed state:

1. Kun retains the old selected package.
2. It creates a recoverable backup of committed state containing global and every workspace namespace.
3. It calls `migrateState(state, context)` exported by Node `main` separately for global and each workspace namespace. `context` supplies `scope`, `fromVersion`, `toVersion`, and `workspace` when available.
4. It validates every output Schema, quota, and namespace.
5. It atomically commits every namespace and schema marker.
6. It then atomically selects/activates the new package.

Conceptual example:

```ts
export async function migrateState(state, context) {
  const next = structuredClone(state)
  if (context.scope === 'global' && context.fromVersion === 1 && context.toVersion >= 2) {
    next.filters = {
      status: next.statusFilter ?? 'all'
    }
    delete next.statusFilter
  }
  return next
}
```

Use same-version lifecycle types for the exact state shape. Migration returns the complete new state and is deterministic, testable, and free of network/model/user interaction. It handles every published forward path and never reads another extension's namespace.

## Failure and interruption recovery

If migration throws, times out, emits invalid state, breaches quota, or fails any namespace commit:

- no mixed state is exposed;
- old committed state is retained/restored;
- old package stays selected;
- from/to, namespace, and a redacted stable diagnostic are reported;
- the new entry does not run.

Backups and commit markers distinguish old committed, complete new committed, and incomplete output. After crash/power loss:

- interruption before commit: discard/quarantine incomplete output and restore old package/state;
- interruption after durable commit/selection: recognize new state and do not rerun completed migration.

Kun writes a per-extension, single-transaction journal at `extension-data/<extension-id>/state/version-switch.json`. It records the previous registry selection, target package or development generation, from/to schemas, the name and digest of the exact prior-state backup, and the `started`, `state-prepared`, or `selection-committed` phase. Ordinary state writes and the complete version switch share one extension-level serialization fence, so no broker state write can land between migration commit and package selection.

Startup, CLI operations, and activation admission recover this journal first. If the registry already selects the target and committed state has the target schema, Kun completes the new transaction and removes the marker. Otherwise it restores the exact prior state and prior selection recorded by the journal. Recovery is repeatable, and a newly copied but unregistered package directory is moved into staging quarantine before deletion. A process exit after the state write but before the registry write therefore cannot expose new-schema state to old code; an exit after the atomic registry write does not rerun migration.

A new archive remains under `.staging/install-*` during admission and migration. In the commit callback Kun verifies integrity again, moves it into the immutable canonical version directory, makes it read-only, and writes the registry. Startup recovery removes interrupted install staging and canonical orphans that have no registry record; it never removes a registered version.

## Core Provider credential migration transaction

Legacy Provider-key migration has a journal separate from extension-state migration, but follows the same rule: plaintext settings are the old committed state, protected credential + account + Provider Binding are the prepared state, and secret-free settings are the new committed state.

- `*.pre-extension-credential-migration.json` is a non-overwriting, one-time backup of old settings;
- `legacy-credential-migrations.json` distinguishes prepared and complete with `secure-committed` / `settings-committed`, storing only salted digests and opaque references;
- `provider-bindings.json` stores `providerId/accountId/modelId` under a source scope, while the Credential Store holds the secret;
- ordinary `kun-settings.json` and GUI-managed Kun `config.json` contain no Provider/runtime plaintext after commit.

An ordinary-settings atomic-write failure rolls back the pending credential/account/Binding. After a process interruption, startup recovery uses the presence of legacy plaintext plus the journal phase to roll back prepared state or finalize the marker. Equal secrets for one Provider may share an account; a distinct runtime override is never overwritten by the profile credential. The compatibility backup supports one release cycle, while the secure account/Binding remains and becomes unavailable if its Provider is missing.

## Rollback and downgrade

Kun never:

- invokes a forward migration in reverse;
- guesses reverse transformations from fields;
- exposes new-Schema state to code declaring an older Schema only.

Manual rollback succeeds only with a compatible retained state snapshot or an explicit forward-compatible-state declaration by the old package. Otherwise it atomically refuses and retains current package/state.

Retaining the previous package does not guarantee rollback; state compatibility still applies. Test upgrade → state write → rollback before release.

## Package selection never happens automatically

A higher package/API version or a new Index entry causes no automatic update. Kun does not poll, compare, or prompt. Admission/consent/migration begins only after explicit selection of an exact package. Failure never silently chooses another installed version.

## Raw DOM exclusion

Host DOM, selectors, CSS classes, React structure, layout, and raw dependencies of `hostContentScripts` are outside current+previous-major guarantees. A Kun patch/minor may change them without adapters.

This does not weaken stable View/message/command/theme/state SDK behavior. If an extension uses only public contracts, Kun internal DOM changes preserve behavior during the support window.

## Documentation and artifact alignment

Every SDK, Schema, CLI, template, example, API reference, compatibility matrix, and Changelog identifies the API/Kun version it documents. Documentation, SDK coordinates, and migration guidance for current and previous API majors remain accessible during support.

CI rejects:

- SDK export change without API reference/Changelog;
- generated Schema/runtime-source drift;
- sample using API/Manifest version outside its page range;
- Chinese/English heading or snippet drift;
- failed current/previous-major fixture or incompatibility rejection;
- failed migration crash-recovery/rollback fixture.

## Extension upgrade procedure

1. Update to the target SDK and read Changelog/deprecations.
2. Retain or explicitly raise `apiVersion`; do not change only package version.
3. Set `engines.kun` to the actually tested range.
4. Prepare renewed-consent copy for Manifest/permission additions.
5. For state-shape change, raise `stateSchemaVersion`, implement forward migration, and add rollback fixtures.
6. Test current/previous API-major fixtures when publishing a compatible package.
7. Validate/pack and test upgrade, migration failure, crash recovery, and manual rollback.
8. Update bilingual docs, compatibility matrix, and Changelog.
