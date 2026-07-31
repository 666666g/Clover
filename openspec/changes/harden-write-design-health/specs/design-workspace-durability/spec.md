## ADDED Requirements

### Requirement: Checked Design persistence
All Design-owned durable writes SHALL distinguish success, resolved failure, and thrown failure. UI and store state SHALL NOT report a durable success when the IPC result is not successful.

#### Scenario: Export resolves with failure
- **WHEN** a Design contract, interoperability package, or report write resolves with `ok: false`
- **THEN** the UI SHALL show an error and SHALL NOT show an exported-success state

#### Scenario: Initial board write fails
- **WHEN** the initial Canvas file cannot be written
- **THEN** the Design store SHALL NOT register a durable board artifact for the missing file

#### Scenario: Background persistence fails
- **WHEN** document index, artifact metadata, Canvas, or design-system persistence fails
- **THEN** the active Design workspace SHALL receive an observable persistence error while retaining recoverable in-memory state

### Requirement: Ordered and flushable Design persistence
Design-owned writes SHALL be ordered by workspace/path, and every debounced document-index, Canvas, and design-system write SHALL be flushable before the owning workspace lifecycle ends.

#### Scenario: Rapid writes to one path
- **WHEN** multiple updates target the same Design file before earlier writes finish
- **THEN** disk SHALL end with the latest queued payload and an older completion SHALL NOT overwrite it

#### Scenario: Design surface unmounts
- **WHEN** Design mode unmounts with pending debounced durable writes
- **THEN** those payloads SHALL be submitted to the ordered write queue and the queue SHALL be flushable

### Requirement: Bounded Design image cache
The Design image-source cache SHALL enforce both entry-count and conservative byte-cost limits, SHALL evict least-recently-used values, and SHALL support workspace-scoped clearing.

#### Scenario: Cache exceeds its byte budget
- **WHEN** inserting a resolved image would exceed the configured cache budget
- **THEN** least-recently-used entries SHALL be evicted until the cache is within all limits

#### Scenario: Workspace is reset
- **WHEN** a Design workspace is replaced or reset
- **THEN** cached workspace image values for the old workspace SHALL be released

### Requirement: Workspace-isolated hydration
Design hydration generations, deletion tombstones, and user-created-document tracking SHALL be scoped by normalized workspace root and bounded for a long-running renderer session.

#### Scenario: Late hydration from previous workspace
- **WHEN** workspace A begins hydration, the active workspace changes to B, and A completes later
- **THEN** A's documents and artifacts SHALL NOT be committed into B's state

#### Scenario: Same identifier in different workspaces
- **WHEN** an artifact or document identifier is removed in workspace A and the same identifier exists in workspace B
- **THEN** workspace B's item SHALL remain eligible for hydration

### Requirement: Structurally safe Canvas documents
Persisted Canvas documents SHALL be accepted only when their object graph is finite, bounded, rooted, acyclic, internally referentially valid, and consistent with parent pointers.

#### Scenario: Cyclic child graph
- **WHEN** a persisted Canvas document contains a direct or indirect child cycle
- **THEN** parsing SHALL reject the document without recursive stack overflow

#### Scenario: Missing or multiply referenced child
- **WHEN** a child identifier is missing, duplicated under a parent, referenced by multiple parents, or disagrees with its `parentId`
- **THEN** parsing SHALL reject the document

#### Scenario: Valid version 1 document
- **WHEN** a structurally valid version 1 Canvas document is loaded
- **THEN** its coordinates SHALL be migrated iteratively and the returned document SHALL remain compatible with version 2 consumers
