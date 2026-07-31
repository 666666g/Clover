## Context

Provider connection testing and model import currently share `probeModelProvider`, which requests the configured provider's model-list endpoint and returns only model IDs. The renderer then classifies those IDs using naming heuristics and adds them to provider capability lists; it does not create model profiles for newly discovered models. The existing `ModelProviderModelProfileV1` already has the runtime-relevant fields needed for context limits, output limits, text/image modalities, tool calling, and message-part behavior.

models.dev publishes one public provider-indexed JSON catalog with richer model metadata. Its provider keys distinguish regions and subscription plans, but their IDs and base URLs do not always exactly match Kun preset IDs. The catalog is several megabytes, changes independently of the app, and must not become a hard dependency for importing models from a configured provider.

## Goals / Non-Goals

**Goals:**

- Fetch provider-reported models and the accurately matched models.dev catalog together when the user imports models.
- Preserve source provenance and make API-confirmed availability visibly different from catalog-only candidates.
- Map only runtime-safe metadata into existing model profiles without overwriting deliberate user or preset configuration.
- Handle catalog latency, size, malformed data, stale cache, unmapped providers, and partial source failures predictably.
- Cover Token Plan, Coding Plan, and regular API profiles for which an exact provider/region mapping can be maintained.

**Non-Goals:**

- Replacing provider connection tests or treating models.dev as proof that a model is enabled for a user's account.
- Fuzzy matching arbitrary custom providers, automatically importing an entire OpenAI/Anthropic catalog for subscription profiles, or changing model request protocols.
- Persisting descriptive catalog fields such as price, release dates, lifecycle status, or descriptions in settings.
- Expanding stored modalities beyond the current text/image profile contract or changing the settings schema version.

## Decisions

1. **Add a dedicated main-process catalog operation.** `probeModelProvider` remains the configured-provider request and connection test. A separate `fetchModelsDevCatalog` operation is invoked only by model import, so catalog outages never affect ordinary connection testing and each source can report status independently. The shared contract contains sanitized catalog entries rather than exposing the raw models.dev response.

2. **Use explicit profile and normalized-base-URL mappings.** Known Kun preset/profile IDs map to exact models.dev provider keys, with base URL selecting regional variants. Exact normalized API URL matching is allowed as a fallback for custom-named profiles. There is no fuzzy name or hostname similarity matching. ChatGPT and Claude subscription profiles may enrich IDs returned by their own source but do not contribute catalog-only rows.

3. **Fetch the public catalog once and cache it in memory.** The main process uses the app's configured global proxy, a 10-second timeout, an 8 MiB response ceiling, an ETag conditional refresh, six-hour freshness, and in-flight request deduplication. On refresh failure, a previously parsed catalog remains usable and is marked stale. Provider credentials are never included in the models.dev request.

4. **Merge in the renderer through a source-aware entry model.** Model IDs are deduplicated case-insensitively; provider-API casing wins. Rows record `provider-api`, `models-dev`, or both. API/both rows are initially selected, while catalog-only rows remain unchecked. The dialog exposes source filters, counts, capability badges, and independent warnings so users can judge unverified candidates before import.

5. **Use catalog modalities before identifier heuristics.** models.dev input/output modality data guides chat/image/audio/video classification when it maps to an existing Kun capability. Existing ID patterns remain the fallback and continue to handle models without catalog data. Unsupported catalog modalities are display-only and do not extend the persisted schema.

6. **Persist a conservative subset of metadata.** `limit.context`, `limit.output`, text/image input and output modalities, `tool_call`, and image message-part support map into `ModelProviderModelProfileV1`. New chat models receive a mapped profile. Existing models with no explicit profile may be enriched. Existing profiles only receive missing context/output limits; modality, tool, protocol, aliases, response mode, and reasoning settings are never overwritten. Descriptions, display names, reasoning flags, costs, dates, and status remain import-dialog data only because some are informational or protocol-specific.

7. **Treat partial success as useful.** If the provider API succeeds and models.dev fails or is unmapped, import behaves like today with a notice. If the provider API fails but models.dev succeeds, the catalog opens with every row unchecked and an availability warning. The operation fails only when neither source provides usable entries.

## Risks / Trade-offs

- **[Risk] Catalog mappings become stale as providers change URLs or models.dev keys.** → Keep mappings centralized, test every supported preset/region, and return `unmapped` instead of guessing.
- **[Risk] A public catalog can advertise models unavailable to the configured account.** → Keep catalog-only rows unselected and clearly label them as unverified.
- **[Risk] Catalog metadata may disagree with a user's custom configuration.** → Preserve existing profile behavior and only fill missing safe limits on established profiles.
- **[Risk] Loading a multi-megabyte JSON document can affect startup or UI latency.** → Fetch lazily only during import, parse in the main process, cache, deduplicate concurrent requests, and return only the matched provider subset.
- **[Risk] models.dev introduces modalities that Kun cannot persist.** → Sanitize the transport type and map only currently supported text/image behavior.

## Migration Plan

No data migration is required. Existing settings remain valid, and imported profile data uses optional fields already supported by the current schema. Rollback consists of removing the catalog IPC and renderer merge path; previously enriched model profiles remain valid settings.

## Open Questions

None.
