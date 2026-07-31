## ADDED Requirements

### Requirement: AgentLoop preserves its public turn boundary
The runtime SHALL retain `AgentLoop` as the externally consumed turn entry point
while delegating internal turn responsibilities through typed internal contracts.
No renderer, preload, Electron IPC, HTTP route, SSE event schema, or tool schema
change is required by this capability.

#### Scenario: Existing runtime starts a turn
- **WHEN** an existing runtime calls the current AgentLoop turn entry point
- **THEN** the turn SHALL retain the existing public inputs, result semantics, and
  observable runtime event contract.

### Requirement: Internal turn services use explicit outcomes
The runtime SHALL represent prepared turn context, model-round outcomes, and
tool-dispatch outcomes with explicit typed records rather than implicit mutation
of an AgentLoop instance.

#### Scenario: Model requests tools
- **WHEN** a model round finishes with one or more tool calls
- **THEN** the model-round service SHALL return a tool-call outcome for the
  orchestrator to dispatch in the existing order.

### Requirement: Turn finalization is once-only
The runtime SHALL finalize a turn at most once across normal completion, error,
cancellation, interruption, and thread deletion.

#### Scenario: Cancellation races with completion
- **WHEN** cancellation is observed while a turn is completing
- **THEN** the runtime SHALL persist and emit no more than one terminal
  finalization outcome for that turn.

### Requirement: Interactive requests are addressable before publication
The runtime SHALL register an approval or user-input gate before publishing the
corresponding requested event. A user-input resolution SHALL reserve the pending
request until its resolved event has been persisted, then settle the waiter from
that reservation.

#### Scenario: Renderer responds while handling a requested event
- **WHEN** a renderer submits an approval or user-input response immediately
  while handling the requested SSE event
- **THEN** the response SHALL find the pending gate instead of returning an
  unknown-request result.

#### Scenario: Cancellation races with an accepted user-input submission
- **WHEN** a valid user-input submission has reserved the pending request and
  its resolved event is being persisted
- **THEN** cancellation SHALL not replace that submission with a contradictory
  waiter outcome or event projection.
