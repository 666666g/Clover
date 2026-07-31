## Context

The renderer stores a per-composer model and provider, threads and turns can each carry overrides, subagent profiles can define their own pair, and Kun owns both a default model client and a map of explicit providers. These fields currently fall back independently. The GUI-managed config also omits the active HTTP provider from the explicit map, even though normal turns and configured subagents send that provider ID explicitly. Strict unknown-provider rejection exposed this pre-existing mismatch.

Diagnostics compound the failure by reading the default client's model and Base URL in the outer catch instead of the effective thread/turn request. Existing persisted settings can therefore be invalid while the displayed error identifies a different model from the one that failed.

## Goals / Non-Goals

**Goals:**

- Make every configured HTTP provider explicitly routable, including the active/default provider.
- Persist and resolve model/provider selections as coherent pairs at every boundary.
- Preserve strict rejection for genuinely unknown providers without silently sending private content through another credential set.
- Make main agents, Write, scheduled/IM/workflow callers, and all subagent modes use the same routing semantics.
- Repair unambiguous legacy mismatches and produce truthful diagnostics for failures.

**Non-Goals:**

- Add another runtime, provider switcher, or legacy agent path.
- Change provider endpoint protocols or upstream request bodies.
- Silently choose among multiple providers that expose the same model ID.
- Rewrite existing thread history solely to update display metadata.

## Decisions

### 1. Keep the default client and also register the active HTTP provider explicitly

The GUI-managed config will include every configured HTTP provider in `serve.providers`; it will no longer skip the active provider. Requests without a provider ID continue to use the default client, while requests with the active provider ID use an equivalent routed client. This is preferred over restoring unknown-provider fallback because strict rejection prevents accidental credential disclosure. Adding a new persisted `defaultProviderId` alias to the Kun config was considered, but duplicating the already normalized provider entry is smaller, works with hot replacement, and preserves the current public config schema.

### 2. Save global composer selections atomically

When no thread is active, selecting a model will save both `agents.kun.model` and `agents.kun.providerId`. Per-thread selections remain local and continue to be sent as turn overrides. A shared resolver will validate whether the selected provider contains the selected model and can infer a provider only when the model belongs to exactly one configured provider.

Saving only the model was rejected because `resolveKunRuntimeSettings` resolves credentials and endpoint from provider ID while retaining the independently stored model.

### 3. Heal only unambiguous legacy global selections

Settings normalization will preserve a valid pair. If the current provider does not expose the stored model and exactly one configured provider does, the provider ID will be repaired to that provider. If no unique match exists, normalization keeps the configured provider and replaces the model with that provider's first usable text model/default rather than guessing credentials.

### 4. Resolve subagent selection as a pair

Delegation will derive the child selection from explicit call fields, profile fields, inherited parent fields, and runtime defaults as paired sources. A complete profile pair wins over inheritance. A profile with only a model may infer a provider only through the configured provider/model catalog; a profile with only a provider uses that provider's configured/default model. Invalid or ambiguous overrides fail before a child turn starts with an actionable message.

The initial implementation will preserve existing profile behavior where complete pairs already exist and add validation around partial combinations. The child thread remains the durable carrier of its effective provider ID.

### 5. Diagnostics are non-throwing and request-scoped

Diagnostic lookup will never throw while describing a routing problem. The outer turn failure path will load the effective turn/thread model and provider ID, then add sanitized Base URL and endpoint format when available. Log fields distinguish `providerId` from `baseUrl`.

## Risks / Trade-offs

- [The active provider is represented by two client instances] → Both are built from the same normalized config and replaced together; add parity tests for credentials, endpoint format, and hot replacement.
- [Legacy repair changes a user's stored selection] → Repair only unique model ownership; otherwise retain the provider and choose one of its configured models deterministically.
- [Providers can expose duplicate model IDs] → Never infer across ambiguous matches; require the provider ID selected by the UI/profile.
- [Concurrent UI work overlaps composer files] → Limit renderer changes to the existing persistence call and focused tests; do not reformat or alter the ongoing visual work.
- [Subagent profiles intentionally use another provider] → Preserve complete profile pairs; they become routable because every provider is registered.

## Migration Plan

1. Register the active provider and add router/config integration coverage.
2. Atomically persist global provider/model selection and normalize legacy mismatches.
3. Validate paired subagent selection and preserve parent inheritance for profiles without overrides.
4. Replace misleading outer-catch diagnostics with effective request fields.
5. Run focused renderer/main/Kun tests, root typecheck, Kun build, and the relevant full suites.

Rollback can revert these focused changes without changing stored thread/session formats. Settings repaired to a valid pair remain valid under the previous application.

## Open Questions

None.
