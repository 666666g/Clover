## Why

Kun currently persists model and provider selections independently while its runtime omits the active HTTP provider from the explicit provider router. After explicit unknown providers became hard errors, valid main-agent, Write, scheduled, and subagent turns can fail before transport, and the fallback diagnostics report the runtime default instead of the failing request.

## What Changes

- Treat provider ID and model ID as one validated selection when saving global composer state and when resolving a turn.
- Register every configured HTTP provider for explicit per-request routing, including the runtime's active/default provider, while preserving default-client behavior for requests without a provider ID.
- Make subagent profile overrides and parent inheritance resolve a coherent provider/model pair for every child run.
- Repair legacy mismatched global settings when a model uniquely identifies its configured provider.
- Report the effective turn model, provider ID, Base URL, and endpoint format without allowing diagnostics to mask the routing failure.
- Add cross-layer regression coverage for main agents, Write turns, configured subagents, inherited subagents, provider switching, stale settings, and unknown providers.

## Capabilities

### New Capabilities

- `agent-model-provider-routing`: Defines coherent model/provider selection, explicit/default provider routing, subagent inheritance, legacy repair, and truthful request diagnostics across every Kun agent entry point.

### Modified Capabilities

None.

## Impact

- Renderer composer persistence and thread/turn request construction under `src/renderer/src/store`.
- Shared settings normalization and model-provider lookup under `src/shared`.
- GUI-managed Kun configuration in `src/main/kun-process.ts`.
- Kun multi-provider routing, model diagnostics, AgentLoop failure reporting, and delegation runtime under `kun/src`.
- Existing settings and thread data remain readable; no public HTTP route is removed or renamed.
