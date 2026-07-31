## Context

Kun's active runtime exposes one public agent-loop entry point, but its current
implementation owns nearly every step of a turn: lifecycle hooks, policy and
context assembly, model streaming, tool calls, compaction, history repair,
goals, events, and finalization. The file is large enough that a small behavior
change can unintentionally alter cancellation, event order, history persistence,
or cache behavior.

The most urgent correctness gap is concurrent history mutation. A turn can append
or repair history while compaction, discard, interruption, or deletion persists a
different snapshot. In-process serialization reduces contention but does not make
a stale read-modify-write safe across independently scheduled paths. Kun's
single-runtime architecture provides one store instance per data directory, so an
opaque in-memory revision can fence these operations without changing the
persisted JSONL format.

The renderer, Electron bridge, and `kun serve` already depend on current HTTP/SSE
events, persisted thread/session formats, tool schemas, and cache prefix
semantics. This change therefore uses an internal strangler pattern rather than a
new runtime or a big-bang rewrite.

## Goals / Non-Goals

**Goals:**

- Keep `AgentLoop` as the public compatibility facade while giving each turn
  concern a focused, testable internal owner.
- Prevent stale history snapshots from overwriting newer session/thread data.
- Preserve observable turn behavior: model request shape, tool order, events,
  final state, usage, error/cancellation semantics, and cache prefix.
- Make each extraction independently reviewable, testable, revertible, and
  releasable.
- Establish deterministic characterization tests before changing the high-risk
  model-round and tool-dispatch control flow.

**Non-Goals:**

- Changing the renderer, preload bridge, Electron IPC, HTTP routes, SSE event
  schema, provider endpoint behavior, or tool schema order.
- Reintroducing a second agent runtime or exposing an implementation switch in
  product settings.
- Replacing stored history files, changing user-visible session semantics, or
  optimizing prompt/cache policy as part of this refactor.
- Solving unrelated resource-limit, SSRF, or Design/SVG work in this change.

## Decisions

### 1. Preserve `AgentLoop` as a thin facade and extract behind typed boundaries

`AgentLoop` SHALL retain its existing externally consumed construction and turn
entry points. New internal services receive narrow dependencies and immutable
input/output records instead of a reference to the loop instance. The target
boundaries are turn lifecycle, context preparation, history coordination, tool
execution/dispatch, model round/stream collection, goal coordination, and
telemetry.

This keeps call sites stable while allowing leaf extraction first. An all-at-once
class replacement was rejected because it would make regressions in event order
and cancellation difficult to localize. Keeping helper functions only in the
existing file was rejected because it would preserve hidden mutable coupling.

### 2. Use per-thread serialization plus in-runtime revision compare-and-swap for history

Every item-history snapshot exposed by the active session store SHALL carry an
opaque monotonically increasing revision. Reads used to derive a replacement
return both the item history and revision; replacement writes commit only when
the expected revision still matches. The history coordinator retries from a
fresh read when a compare-and-swap loses, and per-thread mutation serialization
keeps the usual path cheap and ordered.

The revision is deliberately not serialized into session JSONL. A restart has no
in-flight snapshots from the previous runtime, and the existing single-runtime
contract prevents two serve processes from sharing one data directory. Existing
session item content therefore remains byte-format compatible without migration.

A single process-local mutex alone was rejected because it cannot protect stale
snapshots created outside its scope. Making every caller manually merge arrays
was rejected because repair, discard, and compaction have different semantic
ownership; the coordinator centralizes those retry rules. A multi-process file
lock or database transaction is intentionally out of scope because it would
contradict the current single-runtime ownership model.

### 3. Snapshot turn context before the first model round

The context resolver produces a `PreparedTurnContext` containing stable policy,
workspace, model capabilities, tools, history reference, cancellation signal,
and turn identifiers. It may read runtime state but does not perform model or tool
side effects. Model and tool services consume this context and report explicit
outcomes such as `completed`, `tool_calls`, `retry`, `failed`, or `aborted`.

This avoids a second implicit context assembly path while retaining intentionally
dynamic inputs (for example user replies and approved tool results) through
explicit coordinator calls. Passing the full mutable loop into services was
rejected because it would recreate the original dependency graph.

### 4. Extract in behavior-preserving order

Work proceeds in this order: baseline characterization and stale test correction;
history atomicity; pure types/stream aggregation/telemetry; lifecycle and goals;
context preparation; tools; model rounds; finally facade cleanup. The model round
is deliberately last because it currently connects the most concerns and is the
highest event-order risk.

Each step lands in a focused commit with targeted tests and a Kun build. A
temporary developer-only internal selector can be used for offline replay when
the model-round path is first extracted, but production always has one active
implementation and the selector is removed after release validation.

### 5. Characterize observable behavior rather than private implementation

A deterministic fake model/tool host captures model requests, runtime events,
history/session items, thread state, usage, and tool invocation order. Tests
compare those artifacts for representative plain, tool, approval, user-input,
cancellation, compaction, and failure turns. Assertions intentionally avoid
unstable identifiers, timestamps, and log text.

Snapshotting only final assistant text was rejected because it misses the
regressions most likely during extraction: cache prefix drift, tool ordering,
usage loss, duplicate finalization, and stale history writes.

### 6. Arm interactive gates before publishing their request events

Approval and user-input gates SHALL be registered before their corresponding
requested event becomes observable. A renderer can submit a decision while
handling that event, so publication before registration can make an otherwise
valid HTTP request appear unknown. User-input resolution additionally reserves
the pending request while its resolved event is persisted, then settles the
waiter only after that persistence succeeds. This keeps the event projection and
the waiter outcome consistent when cancellation races with a submission.

Reordering the HTTP route to resolve first was rejected because the loop could
observe the settled promise before the route had persisted its resolved event,
creating duplicate or out-of-order resolution events. Keeping the old
publish-then-arm order was rejected because it permits deterministic 404s for
fast subscribers.

## Risks / Trade-offs

- [Revision state is lost on process restart] → Revisions fence only in-flight
  snapshots; a restart has none. Retain the single-runtime/data-directory
  ownership constraint and do not treat the current hybrid index as a writer
  transaction layer.
- [CAS retries duplicate a side effect] → Only retry pure history transformations;
  model calls, tools, events, and user interactions are never replayed by a CAS
  retry.
- [Extraction changes event order or finalization] → Characterization tests
  capture sequence and explicit once-only finalization tests cover cancellation,
  delete, and error paths.
- [Concurrent Design/SVG work overlaps the loop file] → Add new modules and tests
  first, use minimal hunks in shared files, and stage only owned paths/hunks.
- [Interactive UI resolves a freshly published request immediately] → Arm the
  approval or user-input gate before publication; reserve user-input settlement
  until its resolved event has been persisted.
- [A compatibility flag becomes permanent] → Limit it to developer/offline
  replay, do not expose it through UI or settings, set a removal task, and remove
  it after a release validates the extracted path.

## Migration Plan

1. Establish a clean behavioral baseline and add new isolated test fixtures.
2. Introduce revision-aware session-store APIs and route compaction/repair/discard
   writes through the history coordinator without changing public file content.
3. Extract leaf services one at a time, preserving the facade and adding
   characterization cases before moving high-risk control flow.
4. Run targeted tests and `npm --prefix kun run build` for every increment; run
   the full Kun suite and root typecheck when the shared worktree is clean.
5. Roll back any increment by reverting its focused commit; the facade and stored
   data remain compatible throughout.

## Open Questions

- Whether session writes can be made atomically replaceable with the existing
  filesystem helper or require a small atomic-write helper after inspecting the
  current store implementation.
- Which existing test fixture is best suited as the common deterministic replay
  harness without conflicting with concurrent Design/SVG test edits.
