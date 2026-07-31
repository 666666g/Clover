## Context

Kun has one supported runtime and a stable Renderer -> preload -> main -> `kun
serve` boundary. The remaining health hotspots are not missing abstractions in
isolation; they are large state machines whose lifecycle, protocol, persistence,
and UI responsibilities overlap. Several are concurrently edited, so the work
must use a strangler approach, preserve public behavior, and land in independently
validated commits.

## Goals / Non-Goals

**Goals:**

- Give every runtime state transition, endpoint-family codec, IM channel,
  workflow node, persistence concern, event projection, and complex UI interaction
  one narrow owner.
- Preserve observable HTTP/SSE, session/settings formats, event ordering, provider
  wire requests, cache behavior, and user interaction.
- Make extracted services testable without Electron, network, filesystem, or React
  where those dependencies are not essential.
- Keep every extraction independently buildable, revertible, and releasable.

**Non-Goals:**

- Adding a second runtime, changing provider behavior, redesigning the product,
  migrating stored data, or changing public routes/events.
- Reducing line count through mechanical file splitting without reducing ownership
  or mutable coupling.
- Combining unrelated feature work with the health refactor.

## Decisions

### 1. Use compatibility facades and typed internal outcomes

Existing public classes/functions remain at their import paths. They delegate to
new services whose inputs and outcomes are explicit immutable records. This avoids
coordinated call-site migrations and makes rollback local. Directly replacing each
large class was rejected because it would obscure behavior drift.

### 2. Characterize before moving state transitions

Each domain first gains deterministic tests for requests, events, persistence,
timers, cancellation, and UI projection. Pure helpers/codecs move first; mutable
or side-effecting coordination moves only after transcript/state-machine coverage
exists. Final output-only snapshots are insufficient because order and once-only
effects are load-bearing.

### 3. Preserve a single writer for every state machine

Runtime supervision, IM conversation bindings, workflow runs, thread recovery,
renderer projections, and Composer drafts each receive one coordinator/reducer.
Adapters perform I/O but do not independently repair coordinator state. This is
preferred over additional mutexes around multiple owners.

### 4. Split model compatibility by endpoint family

The public compatible client selects a request codec and stream decoder for chat
completions, Responses, or Anthropic Messages. Shared resource budgets, tool-call
aggregation, usage normalization, retry policy, and diagnostics remain common.
Provider-name branching is not a protocol boundary and is kept in capability or
quirk policy modules.

### 5. Make renderer projection deterministic

Wire events normalize into projection actions; a pure reducer updates chat state;
explicit effect commands trigger notifications, reloads, reconnects, and workspace
refresh. Replay and live SSE use the same reducer. Side effects embedded in mapper
or merge functions are rejected.

### 6. Keep persisted formats byte-compatible

Hybrid store extraction wraps the existing SQLite schema, JSONL documents, and
legacy readers. No field, filename, index schema, or migration marker changes in
this work. Golden existing-session tests prove compatibility before and after each
extraction.

### 7. Generate settings behavior from one domain definition where practical

Shared settings domain modules own types, defaults, normalization, migration, and
provider capability metadata. IPC and UI consume those owners rather than copying
field rules. UI-only presentation metadata remains in the renderer.

### 8. Sequence around concurrent work

Do not edit a hotspot while another active change owns overlapping hunks. Start
with Main lifecycle boundaries, then protocol/IM, renderer/workflow, persistence,
and finally high-churn UI/settings. Rebase assumptions from the live worktree
before every batch and stage only owned files.

## Risks / Trade-offs

- [Facade and extracted owner temporarily duplicate logic] -> Move one behavior at
  a time, compare deterministic transcripts, and delete the old path in the same
  increment.
- [Timer/cancellation order changes] -> Use fake clocks and deferred promises to
  assert exact single-flight, shutdown, and late-completion behavior.
- [Protocol byte drift] -> Capture request bodies/headers and normalized stream
  transcripts for all endpoint families before extraction.
- [Persisted data corruption] -> Use copied legacy fixtures and assert file/schema
  output remains unchanged; never add a migration in this change.
- [Concurrent feature overlap] -> Defer overlapping batch, keep commits path-scoped,
  and never stage unrelated dirty files.
- [Many small modules make navigation harder] -> Split only around named ownership
  and state boundaries; keep composition facades and local barrel exports narrow.

## Migration Plan

1. Land characterization tests and shared outcome types.
2. Extract Main runtime lifecycle services and validate packaged-start semantics.
3. Extract model protocol codecs and IM channel adapters.
4. Introduce renderer event actions/reducer and workflow execution registry.
5. Extract hybrid persistence owners and complex UI hooks/components.
6. Consolidate settings domain rules and IPC/UI consumers.
7. Run full Kun and root validation plus targeted existing-data, HTTP/SSE, runtime
   startup/shutdown, and renderer replay tests.
8. Roll back any batch by reverting its focused commit; no data migration or public
   contract requires coordinated rollback.

## Open Questions

- Whether `main/index.ts` can fully delegate shutdown before remaining window/tray
  feature work settles; if not, retain a narrow bootstrap facade temporarily.
- Whether the current Composer model-control change has stabilized enough for its
  hooks to be extracted without conflict; this batch remains later in sequence.
