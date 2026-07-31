## Why

`kun/src/loop/agent-loop.ts` currently combines turn orchestration, model streaming,
tool dispatch, history mutation, compaction, goal handling, and telemetry in one
large mutable control flow. That makes a local change hard to review or replay and
leaves cross-store history updates vulnerable to concurrent writes. The runtime now
has enough behavioral coverage and production hardening to split those concerns
without changing the public Kun HTTP/SSE contract.

## What Changes

- Introduce explicit, internally versioned turn-execution contracts so a prepared
  turn, a model-round outcome, and a tool-dispatch outcome can be tested without
  driving the full loop.
- Add revision-aware history commits for session/thread mutations that can race
  with compaction, repair, discard, interruption, or deletion.
- Move lifecycle handling, turn-context preparation, tool execution, model-round
  streaming, goal coordination, and loop telemetry behind focused internal
  services while keeping `AgentLoop` as the compatibility facade.
- Add deterministic characterization coverage that compares model requests,
  emitted runtime events, persisted history, thread state, usage, and tool order
  for representative turns.
- Preserve the current renderer-to-Kun HTTP/SSE API, event shapes, tool schemas,
  cache-prefix behavior, and persisted thread/session compatibility.

## Capabilities

### New Capabilities

- `agent-turn-execution-boundary`: Stable internal contracts and orchestration
  boundaries for an agent turn without changing the public runtime API.
- `history-atomic-commit`: Revision-aware persistence that prevents stale turn,
  repair, and compaction writes from overwriting newer conversation history.
- `agent-loop-regression-contract`: Deterministic replay coverage for observable
  agent-loop behavior during incremental extraction.

### Modified Capabilities

- None.

## Impact

- Affected runtime code: `kun/src/loop/agent-loop.ts`, loop helpers, session and
  thread stores, compaction paths, and focused loop tests.
- No renderer, preload, Electron IPC, provider configuration, or public route
  contract changes are intended.
- Existing persisted sessions remain readable; the active single-runtime store
  assigns opaque in-memory revisions only to reject stale writes, without a
  session-file format migration.
