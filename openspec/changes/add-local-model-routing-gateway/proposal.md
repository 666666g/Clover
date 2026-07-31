## Why

Users can configure several providers that expose the same or interchangeable models, but Kun currently selects exactly one provider per request. A local route-pool layer can combine those independent quotas, automatically fail over from unhealthy providers, and present one stable model alias to Kun and local API clients.

## What Changes

- Add persistent virtual model route pools backed by ordered provider/model targets with priority, round-robin, weighted, least-latency, and stability-first adaptive strategies.
- Add capability-aware target filtering, structured provider failure classification, pre-output failover, circuit breaking, bounded health metrics, and route event history.
- Expose enabled route pools as multiple models under one named local relay provider throughout Kun model selection, while retaining the actual provider/model target in diagnostics and usage attribution.
- Add loopback-only OpenAI-compatible `/v1/models`, `/v1/chat/completions`, and `/v1/responses` routes served by the existing Kun runtime.
- Add an Advanced Local Relay workspace under Settings > Providers for naming one local relay provider and creating, testing, reordering, and monitoring multiple routed models beneath it.
- Preserve direct provider selection and the single Kun runtime architecture.

## Capabilities

### New Capabilities

- `model-route-pools`: Defines virtual model aliases, routing strategies, target eligibility, failure handling, health state, persistence, diagnostics, and settings UX.
- `local-openai-model-gateway`: Defines the loopback-only OpenAI-compatible model catalog and generation endpoints backed by route pools.

### Modified Capabilities

None.

## Impact

- Shared settings contracts, normalization, IPC validation, and composer model grouping under `src/shared`, `src/main`, and `src/renderer`.
- Kun model-client contracts, provider routing, runtime configuration, persistence, usage metadata, and HTTP routes under `kun/src`.
- The existing provider settings UI gains a second workspace without restoring any retired agent switcher or runtime diagnostics surface.
- Existing provider profiles, direct model selections, threads, and runtime APIs remain compatible.
