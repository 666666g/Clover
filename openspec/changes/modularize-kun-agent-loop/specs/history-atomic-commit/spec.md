## ADDED Requirements

### Requirement: Derived history replacements are revision-aware
The active runtime SHALL associate each item-history snapshot used for a derived
replacement with an opaque revision and SHALL reject a replacement whose expected
revision is no longer current.

#### Scenario: Compaction races with a newer append
- **WHEN** compaction derives a replacement from revision N and another turn
  commits history revision N+1 before compaction persists
- **THEN** compaction SHALL not overwrite revision N+1 with its stale snapshot.

### Requirement: History transformations retry only from fresh persisted state
The history coordinator SHALL reload and recompute a pure derived transformation
after a revision conflict before it commits the replacement.

#### Scenario: Repair loses a compare-and-swap race
- **WHEN** history repair encounters a revision conflict
- **THEN** it SHALL recompute the repair from the newer persisted session without
  replaying model calls, tool calls, approvals, or runtime events.

### Requirement: Existing sessions remain format-compatible
The session store SHALL preserve the existing persisted session item format while
using revisions only inside the active single-runtime store instance.

#### Scenario: Existing session file is loaded
- **WHEN** the runtime opens an existing session item file
- **THEN** it SHALL expose the same session items and allow a successful
  revision-aware replacement write without rewriting the file format.
