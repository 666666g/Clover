## ADDED Requirements

### Requirement: Representative turns have deterministic observable transcripts
The Kun test suite SHALL provide deterministic fixtures that capture model
requests, runtime event order, persisted history, thread state, usage, and tool
invocation order for representative agent turns.

#### Scenario: Tool turn is replayed in a test fixture
- **WHEN** a deterministic fake model returns a tool call followed by a final
  response
- **THEN** the test SHALL be able to assert the request sequence, tool order,
  emitted event sequence, final persisted history, thread status, and usage.

### Requirement: Characterization assertions ignore unstable implementation detail
The regression fixture SHALL normalize unstable identifiers, timestamps, and log
text while retaining externally observable ordering and payload semantics.

#### Scenario: Equivalent runs have different generated identifiers
- **WHEN** two otherwise equivalent deterministic turns generate different
  internal identifiers or timestamps
- **THEN** the characterization comparison SHALL treat their normalized
  transcripts as equal.

### Requirement: High-risk extraction paths retain cancellation coverage
The test suite SHALL cover cancellation, deletion, approval, user input,
compaction, and failure alongside normal and tool turns before the model-round
control flow is moved.

#### Scenario: Thread deletion interrupts a pending turn
- **WHEN** a pending deterministic turn is deleted
- **THEN** the transcript SHALL show one terminal outcome and no post-delete model
  or tool side effect.
