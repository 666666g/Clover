## ADDED Requirements

### Requirement: Separate index and document ownership
Hybrid thread persistence SHALL isolate SQLite index operations, thread/session
document reads, projection assembly, recovery, and backfill behind typed boundaries.

#### Scenario: Read indexed thread with JSONL history
- **WHEN** a thread has index metadata and persisted item history
- **THEN** the assembled thread and summary SHALL preserve all current merge rules

### Requirement: Persisted format compatibility
The extraction SHALL not change SQLite schema, JSONL records, legacy thread files,
filenames, or recovery precedence.

#### Scenario: Open existing data directory
- **WHEN** Kun opens a data directory created before this change
- **THEN** list, get, search, archive, usage recovery, and subsequent writes SHALL
  work without migration or data loss
