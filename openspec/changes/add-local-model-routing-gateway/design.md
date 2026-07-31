## Context

Kun already builds one `CompatModelClient` per configured provider and routes explicit `providerId` values through `MultiProviderModelClient`. The current router performs direct selection only; retries remain local to a provider client, failures are mostly string-coded stream events, model groups describe only concrete providers, and the HTTP server exposes control-plane thread routes rather than OpenAI generation endpoints.

The change must preserve the single-runtime architecture, existing provider settings, streaming/tool safety, protected upstream credentials, and hot configuration. The external gateway is intentionally unauthenticated by product choice, so it can only be enabled on loopback listeners.

## Goals / Non-Goals

**Goals:**

- Represent a stable public model alias backed by multiple concrete provider/model targets.
- Share routing behavior across native Kun turns and local OpenAI-compatible requests.
- Fail over only before response content is committed and retain truthful target attribution.
- Offer deterministic and health-aware strategies with bounded, restart-safe metrics.
- Provide an implementable Settings > Providers management surface.

**Non-Goals:**

- A second agent runtime, a standalone proxy daemon, LAN exposure, or provider credentials in renderer state.
- Nested route pools, arbitrary protocol translation outside supported Kun codecs, or replay after partial output.
- Routing media-generation capabilities other than model input/output supported by the model client port.

## Decisions

### Route pools are separate settings entities

`ModelProviderSettingsV1` gains `routePools`. Each pool represents one public model beneath the single local relay provider and has a stable id, public model id, strategy, targets, failover policy, and health policy. The local gateway settings retain the relay provider's display name and API enablement. Targets reference concrete provider ids and concrete model ids only. Normalization drops duplicate target ids, disables dangling references, clamps weights/thresholds, and rejects duplicate public model ids across route pools. A public route id may intentionally match a concrete model id; the virtual local-relay provider identity disambiguates routed requests from direct provider selections.

Keeping pools separate from `ModelProviderProfileV1` avoids recursive provider resolution and prevents virtual credentials from being mistaken for upstream secrets. Existing settings without pools normalize to an empty list.

### A routing client wraps direct provider routing

A `RoutePoolModelClient` wraps `MultiProviderModelClient`. It receives normalized pool definitions, model capability lookup, a clock/random source, and a bounded health store. Requests whose model is not an enabled pool alias pass through unchanged. Pool requests build an eligible target list, rewrite `model` and `providerId` per attempt, and delegate to the direct router.

The five strategies are priority order, round robin, smooth weighted round robin, lowest EWMA latency, and adaptive. Adaptive scoring prioritizes recent success rate, then penalizes latency and consecutive failures. Open/half-open circuit state and per-request capability requirements are always applied before strategy selection.

### Failures become structured without breaking consumers

Model error chunks gain optional failure metadata containing category, HTTP status, provider code, retry-after delay, failover permission, and target attribution. Existing `message` and `code` fields remain. `CompatModelClient` classifies transport, timeout, authentication, quota, rate-limit, unavailable, model-not-found, request, and unknown failures.

The route client buffers only pre-commit metadata. Text, reasoning, tool deltas/completions, or generated images commit a target immediately and are yielded without replay. A pre-commit failover-eligible error closes that attempt and selects the next target. Terminal request errors and all post-commit errors are forwarded immediately. Exhaustion produces one sanitized aggregate error.

### Health persistence is bounded and separate from circuit state

Per-pool/target rolling counters, EWMA latency, last error, and a bounded event list are persisted below the Kun data directory using atomic JSON replacement. Circuit state is memory-only and starts closed after restart. Hot config replacement preserves metrics for still-existing targets and drops removed targets.

### Local generation routes use the same model port

The existing Kun router registers `/v1/models`, `/v1/chat/completions`, and `/v1/responses` only when the gateway is enabled and the effective listener is loopback. Startup and hot apply reject an enabled unauthenticated gateway on a non-loopback host.

Request codecs validate bounded JSON, map messages, tools, image parts, cancellation, streaming, token limits, and reasoning controls into `ModelRequest`, then map model chunks back to the requested OpenAI wire format. The public alias stays in responses while route telemetry records the concrete target. These routes bypass thread/session persistence but reuse the same routed client and usage normalization.

### Renderer edits normalized shared settings

Settings > Providers gains a top workspace switch. The relay workspace first presents one named local relay provider, then a routed-model list and per-model detail editor. Each routed model derives target choices from concrete provider models, supports native drag reorder, and exposes strategy/failure/health controls. Runtime health and route tests are fetched through constrained preload/main IPC backed by Kun control routes; secrets never return to the renderer.

Enabled pools are appended as models within one virtual local relay provider group for composer, workflow, schedule, and IM selection. Each public model retains its own aggregated capability metadata, while runtime eligibility remains request-specific.

### Complete route tests are Runtime-owned asynchronous jobs

Starting a complete route test creates a bounded diagnostic job inside the active Kun Runtime and returns immediately. The job owns its cancellation lifetime, so closing or switching the settings page and completing the initiating HTTP request do not stop upstream attempts. A test id is attached only to diagnostic route events, allowing the Runtime to reconstruct the current target, every normalized attempt, latency, final target, output, and terminal error without changing ordinary route telemetry.

The route status control endpoint returns the newest bounded test records together with pool, health, and event state. The renderer polls this endpoint while the relay workspace is mounted and derives all progress and history from Runtime state rather than component-local state. Active starts for the same pool are deduplicated. The test control stays disabled until the saved pool definition exactly matches the Runtime's hot-applied operational definition, preventing a newly enabled or edited pool from being tested against stale configuration. Diagnostic jobs survive page navigation but are intentionally reset with the Runtime process.

## Risks / Trade-offs

- [Unauthenticated local API can be used by any local process] → Hard-bind it to loopback, refuse unsafe host combinations, and display a persistent warning.
- [Provider-local retries can delay failover] → Preserve existing retry settings but add no second same-target retry in the route client; expose attempt timing in route events.
- [Heterogeneous models can produce different answers] → Show every concrete target and filter by required capabilities rather than claiming semantic equivalence.
- [Adaptive routing can starve cold targets] → Give never-sampled and half-open targets bounded probe opportunities before normal scoring.
- [Hot edits race active streams] → Snapshot one normalized pool at request start; apply new configuration only to later requests.
- [API codec surface is large] → Support the request fields already represented by `ModelRequest`, reject unsupported fields explicitly, and cap request/history/tool/image sizes.

## Migration Plan

1. Normalize old settings with `routePools: []`; no persisted migration rewrite is required until the next settings save.
2. Ship route configuration disabled by default and gateway disabled until at least one valid pool is enabled.
3. Hot-apply pools to Kun; direct provider/model requests remain on the existing path.
4. Rollback removes/ignores `routePools` and gateway config while leaving concrete provider profiles intact.

## Open Questions

None. Product decisions are fixed: all five strategies, capability filtering, pre-output-only failover, loopback without authentication, both OpenAI generation shapes, authentication failures switch targets, and persisted metrics with reset circuit state.
