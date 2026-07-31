## 1. Baseline and regression guardrails

- [x] 1.1 Record the current targeted Kun build/test baseline and isolate any
  failures caused by concurrent work from the agent-loop baseline.
- [x] 1.2 Correct the sandbox expectation in the existing shell-runtime test by
  making its intentionally unsafe fixture explicit.
- [x] 1.3 Add deterministic transcript fixture utilities that normalize unstable
  values and collect model requests, events, history, thread state, usage, and
  tool invocation order.
- [x] 1.4 Make approval and user-input gates addressable before their requested
  events are published, and serialize user-input resolution event persistence
  with settlement so cancellation cannot create a contradictory projection.
- [x] 1.5 Characterize normal, tool, approval/user-input, cancellation/deletion,
  compaction, and failure turns using the transcript fixture.

## 2. Revision-aware history commits

- [x] 2.1 Map all session/thread read-modify-write paths used by append, repair,
  discard, compaction, interruption, and deletion.
- [x] 2.2 Add in-runtime item-history revision read and compare-and-swap
  primitives without changing persisted session formats.
- [x] 2.3 Implement a history coordinator that serializes per-thread mutations
  and retries only pure transformations after a revision conflict.
- [x] 2.4 Route compaction, history repair, and discard replacement writes through
  the coordinator without replaying model or tool side effects.
- [x] 2.5 Add existing-session and concurrent append/compaction/repair race tests.

## 3. Low-risk internal boundaries

- [x] 3.1 Introduce immutable prepared-turn, model-round, and tool-dispatch type
  contracts with focused unit tests.
- [x] 3.2 Extract pure stream aggregation and loop telemetry helpers without
  changing event payloads or ordering.
- [x] 3.3 Extract turn lifecycle/finalization and goal-resume coordination with
  once-only terminal outcome tests.

## 4. Context and tool pipeline boundaries

- [x] 4.0 Extract pure tool-dispatch lane and homogeneous-batch policy without
  moving suppression, execution, result persistence, or event ordering.
- [x] 4.0a Extract the interactive approval/user-input bridge while preserving
  approval's event-only projection and user-input's item-plus-event lifecycle.
- [x] 4.0b Extract the execution-only tool context factory, keeping discovery
  context separate so it cannot accidentally gain real approval side effects.
- [x] 4.1 Extract turn-context resolution while preserving model, policy,
  workspace, attachment, memory, skill, and tool-schema inputs.
- [x] 4.2 Extract tool execution service with existing approval, user-input,
  cancellation, sandbox, and tool-result semantics.
- [x] 4.3 Extract ordered tool-call dispatch and verify suppression, limits, and
  error behavior against characterization transcripts.

## 5. Model-round extraction and facade cleanup

- [x] 5.1 Extract the model-round engine and stream collector behind explicit
  outcomes while preserving request/cache-prefix and retry behavior.
- [x] 5.2 Compare representative legacy and extracted model-round transcripts in
  offline deterministic tests, then remove any temporary internal selector.
- [x] 5.3 Reduce AgentLoop to its public facade plus narrow composition wiring and
  remove obsolete duplicated helpers.

## 6. Validation and handoff

- [x] 6.1 Run focused tests and `npm --prefix kun run build` for every completed
  extraction increment.
- [x] 6.2 Run the full Kun suite and root typecheck when concurrent work no longer
  blocks the shared worktree, documenting unrelated baseline failures separately.
- [x] 6.3 Review public HTTP/SSE, persisted-session, tool-schema, and cache-prefix
  compatibility before declaring the change complete.
