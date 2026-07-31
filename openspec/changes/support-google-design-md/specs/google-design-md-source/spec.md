## ADDED Requirements

### Requirement: Canonical workspace-root DESIGN.md discovery
The system SHALL treat the exact workspace-root path `DESIGN.md` as the canonical public project design-system source and SHALL NOT discover nested artifact notes or `.kun-design/DESIGN.md` as that source.

#### Scenario: Root file exists
- **WHEN** a selected workspace contains a readable root `DESIGN.md`
- **THEN** the system loads, validates, watches, and exposes that file as the project design system

#### Scenario: Root file is absent
- **WHEN** the selected workspace has no root `DESIGN.md`
- **THEN** the system reports a missing source and does not render a design-system board or empty-state canvas node

#### Scenario: Nested note exists without root file
- **WHEN** only `.kun-design/<document>/<artifact>/DESIGN.md` or `.kun-design/DESIGN.md` exists
- **THEN** the system does not treat either file as the project design system

### Requirement: Google alpha file structure parsing
The system SHALL parse DESIGN.md as YAML front matter followed by Markdown rationale and SHALL support the Google alpha fields `version`, `name`, `description`, `colors`, `typography`, `rounded`, `spacing`, and `components`.

#### Scenario: Google-compatible file is loaded
- **WHEN** DESIGN.md contains valid YAML token values, token references, and ordered Markdown sections
- **THEN** the system produces a normalized design-system model and retains the original source and source hash

#### Scenario: Unknown extension content is present
- **WHEN** DESIGN.md contains unknown token names, top-level extension keys, component properties, or Markdown sections
- **THEN** the system preserves that content and emits warnings only where required by the pinned specification

#### Scenario: Duplicate section or broken structure is present
- **WHEN** DESIGN.md violates a structural error rule such as duplicate canonical sections or malformed YAML fences
- **THEN** the system rejects the new model, reports path-aware diagnostics, and does not partially apply its tokens

### Requirement: Validation and last-valid behavior
The system SHALL expose structural, token-reference, CSS value, section-order, missing-token, and WCAG contrast diagnostics and SHALL keep the last valid project model visible when a later persisted revision is invalid.

#### Scenario: Valid file has warnings
- **WHEN** DESIGN.md parses successfully but the linter reports warnings or information
- **THEN** the system renders the model and exposes the findings without blocking use

#### Scenario: External edit makes the file invalid
- **WHEN** a watched valid DESIGN.md is replaced by invalid content
- **THEN** the system shows the invalid source and diagnostics in the inspector while the board continues to render the last valid model

#### Scenario: First observed file is invalid
- **WHEN** no prior valid model exists and the first root DESIGN.md is invalid
- **THEN** the system shows an error entry point without rendering a fabricated theme specimen

### Requirement: Robust file lifecycle synchronization
The system SHALL handle initial reads, atomic rename saves, content updates, deletion, workspace switches, and watcher failures without stale cross-workspace updates or indefinite loading.

#### Scenario: Editor saves by atomic rename
- **WHEN** an external editor replaces DESIGN.md using a temporary file and rename
- **THEN** the watcher reattaches as needed and commits the new valid revision once

#### Scenario: File is deleted
- **WHEN** the watched root DESIGN.md is removed
- **THEN** the system clears the public project model and board while preserving internal canvas component-tree state

#### Scenario: Workspace changes during a pending read
- **WHEN** a DESIGN.md read or watch event for workspace A resolves after the user selects workspace B
- **THEN** the stale result is ignored and cannot update workspace B

### Requirement: Conflict-safe round-trip persistence
The system SHALL preserve unknown YAML and Markdown content during structured edits and SHALL refuse to overwrite an externally modified DESIGN.md without user resolution.

#### Scenario: Theme token is edited
- **WHEN** a user changes a recognized token in the Theme inspector and saves
- **THEN** only the corresponding recognized YAML node changes while unknown keys and untouched Markdown sections remain present

#### Scenario: Raw source is edited
- **WHEN** a user edits the raw DESIGN.md tab and saves valid content
- **THEN** the exact validated draft becomes the persisted source and the committed model updates from that source

#### Scenario: Source changed after draft creation
- **WHEN** the current disk hash differs from the draft base hash at save time
- **THEN** the system enters conflict state, blocks the overwrite, and offers reload or draft-copy recovery

### Requirement: Design and code agents consume the canonical source
The system SHALL reference root DESIGN.md in Design generation, validation, implementation, and code-handoff prompts whenever a valid file exists and SHALL hash the exact valid source for implementation provenance.

#### Scenario: Generating a new screen with a design system
- **WHEN** a valid root DESIGN.md exists and the Design agent prepares a screen turn
- **THEN** the prompt instructs the agent to read and follow that file before designing

#### Scenario: Implementing a design artifact
- **WHEN** a user sends an HTML design to implementation with design-system publication enabled
- **THEN** the implementation prompt references root DESIGN.md and records its source hash

#### Scenario: No valid source exists
- **WHEN** DESIGN.md is missing or has never produced a valid model
- **THEN** prompts do not claim that a project design system exists

### Requirement: Structured agent modifications
The `design_system` tool SHALL create, patch, validate, and apply root DESIGN.md through revision-aware structured operations and SHALL preserve prose and unknown extensions.

#### Scenario: Agent creates a system
- **WHEN** the user asks for a design system and root DESIGN.md is missing
- **THEN** the tool creates a Google-compatible file with valid front matter and useful rationale sections rather than drawing an HTML/SVG style-kit artifact

#### Scenario: Agent patches tokens
- **WHEN** the agent submits structured token or section changes with the current source hash
- **THEN** the tool applies the patch, validates the result, and returns the new hash and diagnostics

#### Scenario: Agent uses a stale revision
- **WHEN** the tool's expected source hash does not match disk
- **THEN** the tool rejects the patch as a conflict without overwriting the external edit

### Requirement: Legacy migration and path disambiguation
The system SHALL support non-destructive migration from `.kun-design/design-system.json` and SHALL publish Kun project handoff output to `.kun-design/HANDOFF.md`.

#### Scenario: Legacy JSON exists without root file
- **WHEN** a valid legacy project JSON exists and root DESIGN.md is absent
- **THEN** the system offers a Google-compatible migration draft but keeps the board hidden until the draft is saved

#### Scenario: Migration is accepted
- **WHEN** the user saves the migration draft
- **THEN** the system writes root DESIGN.md, preserves unmappable rich editor data internally, and leaves the legacy JSON file untouched

#### Scenario: Project handoff is exported
- **WHEN** the user or agent exports the Kun project handoff
- **THEN** the writer targets `.kun-design/HANDOFF.md`, references root DESIGN.md, and does not create `.kun-design/DESIGN.md`

#### Scenario: Old handoff is imported
- **WHEN** compatibility code encounters an existing `.kun-design/DESIGN.md` Kun handoff
- **THEN** it can read the handoff without interpreting it as the project theme or deleting it

### Requirement: Bounded and safe source processing
The system SHALL reject DESIGN.md sources larger than 512 KiB and SHALL never execute HTML, scripts, remote font imports, URL-bearing CSS, or event handlers from the file.

#### Scenario: Oversized file is discovered
- **WHEN** root DESIGN.md exceeds the supported source limit or the workspace read is truncated
- **THEN** the system reports a size diagnostic and does not parse or render a partial file

#### Scenario: Markdown contains HTML or script
- **WHEN** the Markdown body includes raw HTML, scripts, or event attributes
- **THEN** the inspector treats it as source text and the board renders no executable content from it

#### Scenario: Token contains remote resource CSS
- **WHEN** a token value contains `url()`, `@import`, or another remote resource form
- **THEN** the value is rejected or ignored for preview styling with a diagnostic
