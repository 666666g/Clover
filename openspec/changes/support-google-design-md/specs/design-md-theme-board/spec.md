## ADDED Requirements

### Requirement: Deterministic built-in theme specimen
The Design whiteboard SHALL render a fixed built-in theme specimen from the last valid root DESIGN.md model and SHALL NOT persist that specimen as a canvas shape, HTML artifact, or SVG artifact.

#### Scenario: Valid design system becomes available
- **WHEN** a valid root DESIGN.md is committed
- **THEN** one built-in specimen appears in stable canvas coordinates and reflects the parsed tokens

#### Scenario: Board is reopened
- **WHEN** the user reloads or switches away from and back to a document
- **THEN** the specimen uses deterministic ordering and placement without creating duplicate artifacts or layers

#### Scenario: Project source becomes missing
- **WHEN** root DESIGN.md is deleted or the workspace changes to one without it
- **THEN** the specimen disappears completely

### Requirement: Google-style visual coverage
The specimen SHALL visualize featured colors, generated tonal ramps, representative typography, surfaces, controls, input/search, progress, navigation, action/chip states, rounded values, spacing, and semantic component tokens.

#### Scenario: Full Luminous Stage sample is loaded
- **WHEN** DESIGN.md defines primary, secondary, tertiary, neutral/surface colors and display/headline/body/label typography
- **THEN** the specimen renders four featured palette columns, representative type cards, and theme-derived UI samples comparable in information density to the provided Google reference

#### Scenario: Semantic roles are absent
- **WHEN** color or typography token names do not include the preferred semantic roles
- **THEN** the renderer selects deterministic lexical/luminance fallbacks and labels the original token names without inventing persisted values

#### Scenario: Additional tokens exist
- **WHEN** the file contains more tokens than the featured grid can show
- **THEN** the renderer exposes the remaining tokens in stable supplemental sections rather than dropping them

### Requirement: Safe style normalization
The specimen SHALL apply only validated CSS color, typography, dimension, spacing, and radius values and SHALL use local/system font fallbacks.

#### Scenario: Valid CSS values are present
- **WHEN** a token uses a supported CSS color or dimension format
- **THEN** the corresponding preview sample uses the normalized value while retaining the original source string for editing

#### Scenario: Unsafe or unsupported style value is present
- **WHEN** a style contains a remote URL, import, executable markup, non-finite number, or unsupported unit
- **THEN** the specimen uses a safe fallback and displays a diagnostic without injecting the value

### Requirement: Canvas-native interaction and layout
The specimen SHALL pan and zoom with the whiteboard, remain behind artifact portals according to the canvas layering invariant, and open its inspector without appearing in the normal Layers list.

#### Scenario: Canvas view changes
- **WHEN** the user pans, zooms, fits, or reopens the whiteboard
- **THEN** the specimen maintains its canvas position and scales consistently with native board content

#### Scenario: HTML or SVG artifacts overlap the specimen
- **WHEN** a file artifact portal is placed over the same canvas area
- **THEN** portal ordering remains consistent with the board's top-layer artifact invariant

#### Scenario: Specimen is selected
- **WHEN** the user clicks the specimen header or edit affordance
- **THEN** the design-system inspector opens without adding a selected shape or layer entry

### Requirement: Theme and DESIGN.md inspector tabs
The inspector SHALL provide a Theme tab for structured token editing and a DESIGN.md tab for raw source editing, diagnostics, copy, and unsaved-state visibility.

#### Scenario: Theme tab edit
- **WHEN** the user changes preview mode, a recognized color, typography, spacing, or radius token
- **THEN** the inspector updates a local draft and preview without silently writing the workspace file

#### Scenario: Raw tab edit
- **WHEN** the user edits YAML front matter or Markdown prose
- **THEN** the draft retains the exact source, reports live diagnostics, and does not auto-normalize unknown content

#### Scenario: User switches tabs with invalid raw source
- **WHEN** the raw draft is currently invalid and the user opens Theme
- **THEN** the last parsable structured draft remains visible and the invalid raw draft is retained for correction

### Requirement: Explicit Save and Save & Apply semantics
The inspector SHALL expose Save and Save & Apply actions with distinct, documented scopes and SHALL disable either action when blocking validation or conflict errors exist.

#### Scenario: Save valid draft
- **WHEN** the user presses Save with a valid, non-conflicting draft
- **THEN** root DESIGN.md is persisted and the committed board/agent context updates from that revision

#### Scenario: Save and apply compatible tokens
- **WHEN** the user presses Save & Apply with a valid draft and an active DesignDocument
- **THEN** the file is saved and compatible token values are mapped into native canvas tokens and token-linked objects as one undoable batch

#### Scenario: File artifacts are present
- **WHEN** Save & Apply is used while HTML or SVG artifacts exist
- **THEN** those files are not silently rewritten and the UI explains that explicit agent refactoring is required for existing file content

#### Scenario: Draft is invalid or conflicted
- **WHEN** blocking diagnostics or an external-edit conflict exists
- **THEN** Save and Save & Apply do not overwrite disk or apply partial tokens

### Requirement: Accessible and responsive inspector
The inspector SHALL be keyboard navigable, expose accessible names and diagnostics, preserve focus during file watcher commits, and adapt to the available Design mode width.

#### Scenario: Keyboard-only editing
- **WHEN** a user navigates the inspector without a pointer
- **THEN** tabs, fields, diagnostics, copy, Save, and Save & Apply are reachable with visible focus states

#### Scenario: Narrow window
- **WHEN** the app window cannot show the preferred inspector width
- **THEN** the inspector remains usable through bounded responsive sizing and scrolling without covering all canvas controls

#### Scenario: External valid update arrives while no draft is dirty
- **WHEN** the watched file changes and the inspector has no unsaved edits
- **THEN** fields and source update without losing the user's current tab or keyboard focus unnecessarily
