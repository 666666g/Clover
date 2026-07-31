## Why

Provider model import currently knows only the identifiers returned by each configured API. This leaves Token Plan and compatible API models without reliable context limits, modality support, or tool capability metadata even though models.dev publishes an open, provider-specific catalog containing those details.

## What Changes

- Keep the configured provider API as the authoritative availability source while also loading the matching models.dev provider catalog during model import.
- Merge both sources without hiding either result: API-confirmed models are selected by default, while models.dev-only candidates remain visible and unselected.
- Show source and capability metadata in the import dialog, including context/output limits, image input, tool calling, and reasoning indicators.
- Persist safe runtime metadata into model profiles when importing new models or enriching profiles that do not already define those fields.
- Add explicit provider/region mappings, bounded caching, proxy support, and partial-failure behavior for the public models.dev catalog.
- Keep connection testing and subscription-provider availability unchanged; no provider API key is sent to models.dev.

## Capabilities

### New Capabilities

- `provider-model-catalog-enrichment`: Defines dual-source model discovery, models.dev provider matching, catalog caching, import presentation, and safe model-profile enrichment.

### Modified Capabilities

None.

## Impact

- Shared provider/model catalog contracts and settings profile merge helpers.
- Electron main-process catalog fetching, caching, provider mapping, IPC validation, and preload bridge.
- Provider settings model-import dialog, localized copy, and renderer state flow.
- Unit and component tests for source merging, catalog failures, metadata mapping, and import behavior.
- No Kun runtime HTTP API, stored settings schema version, or model request endpoint behavior changes.
