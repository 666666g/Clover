## Why

Kun currently treats every built-in provider preset as a singleton, so selecting an already configured Token Plan updates the existing profile instead of allowing a second subscription account. Users who buy multiple plan accounts need each credential to remain an independently selectable and routable provider so they can combine account capacity safely.

## What Changes

- Allow every subscription/Token Plan preset to create multiple independent provider profiles instead of replacing the first profile.
- Preserve the originating preset and access mode as profile metadata so duplicated accounts keep preset capabilities, model metadata, validation, badges, and locked identity behavior.
- Generate deterministic unique provider ids and display names, using the base preset for the first account and incrementing a numeric suffix for later accounts (for example `Kimi Code`, `Kimi Code 2`, `Kimi Code 3`).
- Show configured account counts in the provider-add dialog while keeping pay-as-you-go preset update behavior unchanged.
- Keep each account's API key, runtime provider entry, model-selector entry, and local-route target independent, with backward-compatible inference for existing preset profiles.

## Capabilities

### New Capabilities

- `multi-account-model-providers`: Multiple independently configured accounts may be created from one subscription preset with stable source metadata, unique identities, and full downstream provider behavior.

### Modified Capabilities

None.

## Impact

- Shared provider profile contracts, preset factories, settings normalization, capability backfill, and MiniMax media-default selection.
- Settings → Providers add dialog, subscription grouping/badges, preset identity locking, and localized account-count copy.
- Existing runtime provider projection, model selectors, workflow/schedule selectors, and local route targets consume the new unique provider ids without a protocol change.
- Shared and renderer regression tests cover naming, persistence, backward compatibility, independent credentials, and repeated add flows.
