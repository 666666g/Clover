## ADDED Requirements

### Requirement: Deterministic event projection
Live SSE, persisted replay, and thread-detail reconciliation SHALL normalize Kun
events into the same projection actions and reduce them deterministically.

#### Scenario: Replayed completed turn
- **WHEN** a completed turn is reconstructed from the same ordered events
- **THEN** chat blocks, tool state, goal/todo state, and completion identity SHALL
  match the live projection

### Requirement: Explicit renderer effects
Notifications, workspace refresh, reconnect, reload, and IM mirror operations SHALL
be represented as explicit effects outside pure event normalization and projection.

#### Scenario: Duplicate completion event
- **WHEN** replay or reconnect delivers an already projected completion
- **THEN** state SHALL remain stable and the completion notification SHALL run at
  most once
