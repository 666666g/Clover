## ADDED Requirements

### Requirement: Active Write document identity
The Write workspace SHALL assign a monotonically increasing document epoch to each active-file lifecycle and SHALL require asynchronous editor operations to match the originating workspace, file path, and epoch before mutating active state.

#### Scenario: Late file-open response
- **WHEN** file A begins opening, file B begins opening later, and file A resolves last
- **THEN** file B SHALL remain active and file A's response SHALL NOT overwrite its content or status

#### Scenario: Reopen the same path
- **WHEN** an operation starts for a file, the user leaves that file, and later reopens the same path
- **THEN** the old operation SHALL be stale because its document epoch differs

### Requirement: Revision-safe ordered saves
Write saves SHALL be serialized per workspace and file, and a save completion SHALL update the persisted baseline only for its originating document context. Newer unsaved content SHALL remain dirty until that exact content is durably written.

#### Scenario: Edit while save is pending
- **WHEN** revision 1 is saving and the user creates revision 2 before revision 1 completes
- **THEN** completion of revision 1 SHALL NOT mark revision 2 as saved and revision 2 SHALL subsequently be written

#### Scenario: Switch files while save is pending
- **WHEN** a save for file A completes after file B becomes active
- **THEN** the completion SHALL NOT alter file B's persisted baseline, error, or save status

#### Scenario: Failed queued save
- **WHEN** a queued write resolves with `ok: false` or throws
- **THEN** the originating document SHALL remain dirty or error, navigation SHALL NOT treat it as durably saved, and another document SHALL remain unchanged

### Requirement: Context-bound agent review
An agent review SHALL carry its workspace, file path, and document epoch, and SHALL only open against the matching editor document.

#### Scenario: File changes before review consumption
- **WHEN** an agent review is queued for file A and file B becomes active before the review is consumed
- **THEN** the review SHALL NOT open against or modify file B

### Requirement: Context-bound asynchronous editor actions
Rich inline edits, source inline edits, infographic completion, and clipboard-image insertion SHALL verify their originating document context and content/range preconditions before changing the editor.

#### Scenario: Rich rewrite returns after navigation
- **WHEN** a rich-editor rewrite starts in file A and returns after file B is active
- **THEN** the rewrite SHALL NOT be applied to file B even if the selected text also exists there

#### Scenario: Clipboard image finishes after navigation
- **WHEN** clipboard image persistence starts in one document and finishes after the active document changes
- **THEN** the image SHALL NOT be inserted into the new document

### Requirement: Testable Write lifecycle ownership
Autosave, watcher synchronization, unmount flushing, and pending-review consumption SHALL be implemented behind focused lifecycle boundaries with deterministic regression coverage for stale and concurrent operations.

#### Scenario: Regression coverage
- **WHEN** Write workspace tests run
- **THEN** they SHALL exercise out-of-order opens, edit-during-save, cross-file save completion, stale reviews, stale rich rewrites, and stale image-paste completion
