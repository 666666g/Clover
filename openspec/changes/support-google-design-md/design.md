## Context

The current Design mode has two partially overlapping project contracts:

- `.kun-design/design-system.json` is watched as a structured project theme and drives the built-in design-system board.
- `.kun-design/DESIGN.md` is generated as a Kun/Stitch-style handoff, but its table-and-prose structure is not Google's published DESIGN.md schema.

Each HTML/SVG artifact can also own a nested `DESIGN.md` containing screen-level implementation notes, and each DesignDocument can persist a rich internal `design-system.json` containing Kun canvas component trees. Google's alpha DESIGN.md schema can represent semantic component tokens, but not those editor-specific shape trees, slots, variant overrides, or canvas identities.

Google's published format defines a workspace-root `DESIGN.md` with YAML front matter for normative tokens and ordered Markdown sections for rationale. The alpha schema accepts arbitrary color and typography token names, token references, defined component properties, and unknown extension content. Its linter also reports structural, reference, contrast, and section-order findings.

This change crosses renderer persistence, whiteboard rendering, tool protocols, prompts, code handoff, migration, and package dependencies. The implementation must preserve unrelated workspace content, survive atomic editor saves, and avoid turning user-authored Markdown into executable HTML.

## Goals / Non-Goals

**Goals:**

- Make root `DESIGN.md` the single public source of truth for the project theme.
- Accept files produced by Google Stitch and conform to the published alpha schema.
- Render a deterministic, useful theme specimen directly from tokens without creating an agent-authored HTML/SVG style-kit artifact.
- Provide safe Theme and raw DESIGN.md editing with validation, conflict detection, Save, and Save & Apply.
- Feed the same parsed contract to Design generation, validation, implementation, and export paths.
- Preserve Kun-only rich component trees as internal editor state without letting the sidecar override DESIGN.md.
- Migrate legacy project JSON and disambiguate the existing Kun handoff path without data loss.

**Non-Goals:**

- Pixel-copying Google Stitch chrome or using Google proprietary assets.
- Executing Markdown HTML, loading remote fonts, or evaluating arbitrary CSS from DESIGN.md.
- Rewriting arbitrary existing HTML/SVG artifacts when Save & Apply is pressed.
- Removing nested artifact DESIGN.md implementation notes in this change.
- Implementing every future revision of the alpha specification automatically.
- Replacing the native canvas component-tree/variant model with Google's semantic component token map.

## Decisions

### 1. Root DESIGN.md is canonical; other files have explicit roles

The canonical public path is exactly `DESIGN.md` at the selected workspace root. Only that path triggers automatic project-theme discovery and the fixed whiteboard specimen.

The existing `.kun-design/DESIGN.md` project export moves to `.kun-design/HANDOFF.md`. Readers accept the old path for compatibility, but writers never recreate it. Nested artifact files remain implementation notes and are excluded from project-theme discovery. `.kun-design/<document>/design-system.json` remains an internal Kun sidecar for lossless canvas component trees. The old root-level `.kun-design/design-system.json` becomes migration input only.

This avoids path heuristics and gives agents one unambiguous instruction: read root DESIGN.md first.

**Alternative considered:** keep `.kun-design/DESIGN.md` canonical. Rejected because Google tooling, coding agents, and the user's requested working-directory discovery expect the workspace root.

### 2. Pin the Google alpha contract behind a Kun adapter

Add a `design-md` adapter that owns all interaction with the pinned `@google/design.md` programmatic linter/schema version. The rest of Kun consumes a stable internal model:

```ts
type ProjectDesignMdDocument = {
  path: 'DESIGN.md'
  raw: string
  sourceHash: string
  name: string
  description?: string
  colors: Record<string, string>
  typography: Record<string, DesignMdTypography>
  rounded: Record<string, string | number>
  spacing: Record<string, string | number>
  components: Record<string, Record<string, string | number>>
  markdownSections: DesignMdSection[]
  extensions: Record<string, unknown>
  diagnostics: DesignMdDiagnostic[]
}
```

The adapter validates the first YAML fence, normative scalar/object types, CSS color/dimension syntax, token references, duplicate sections, canonical section order, and file-size limits. Unknown top-level keys, unknown token names, unknown sections, and unknown component properties are retained; unsupported component properties produce warnings rather than destructive normalization.

Pinning shields the application from alpha-spec churn. Updating the pinned version becomes an intentional compatibility change with fixtures from the Google repository and user-provided samples.

**Alternative considered:** reuse the existing table-based parser. Rejected because it cannot round-trip YAML front matter, references, arbitrary token names, or official lint semantics.

### 3. Preserve user-authored content during edits

Parsing produces both the normalized model and a round-trip document representation. Structured Theme edits patch only recognized YAML nodes. Raw-tab edits replace the draft source. Markdown prose, unknown sections, unknown YAML keys, and extension values are preserved across structured saves.

Before writing, the editor re-reads DESIGN.md and compares its hash with the draft base hash. A mismatch enters a conflict state and refuses to overwrite; the user can reload the external version or copy their draft. Writes use the existing workspace IPC boundary and the watcher handles atomic rename/replacement.

**Alternative considered:** regenerate the whole file from normalized tokens. Rejected because it would erase rationale and extensions—the part of DESIGN.md that gives agents intent.

### 4. One synchronization store owns file, draft, diagnostics, and last-valid state

Replace the project JSON sync store with a DESIGN.md state machine:

- `loading`: initial read in progress; no board.
- `missing`: file absent; no board and no empty-state canvas node.
- `ready`: valid persisted source; board renders it.
- `dirty`: valid or invalid local draft exists; persisted source remains the last-valid board baseline unless Theme edits are previewed.
- `invalid`: persisted file is invalid; diagnostics are shown and the last valid model remains visible if one exists.
- `conflict`: external source changed after draft creation; save is blocked.
- `saving`: one write is in flight; duplicate saves are coalesced.

Workspace/document context fences prevent late reads or watcher events from updating a newly selected workspace. Deletion clears the project-theme board and normalized public tokens but does not delete internal canvas component state.

### 5. The board is a deterministic built-in specimen

The whiteboard specimen remains a built-in renderer, positioned in canvas coordinates so it pans and zooms with the board. It never evaluates Markdown HTML and never becomes a persisted canvas shape or artifact.

The fixed layout contains:

- Four featured palette cards (`primary`, `secondary`, `tertiary`, `neutral` with semantic fallbacks), each with a generated tonal ramp used only for visualization.
- Representative display/headline, body, and label typography cards chosen deterministically by token-name heuristics, followed by remaining typography tokens.
- Surface/background cards, primary/secondary/inverted/outlined controls, input/search, progress, navigation, chips/actions, radii, and spacing samples.
- Semantic component token examples from the front matter, with unresolved references visibly diagnosed.

Light/dark preview mode is a viewer preference inferred initially from surface luminance and can be toggled without mutating DESIGN.md. All layout ordering is stable by semantic priority then lexical token name.

Only validated CSS colors and dimensions reach inline style properties. `url()`, remote font sources, stylesheet imports, markup, scripts, and event attributes are never rendered. Font family values select installed/system fonts with a safe fallback.

### 6. Inspector is DOM UI; the specimen stays in canvas coordinates

Selecting the project-theme specimen opens a right-side Design inspector with `Theme` and `DESIGN.md` tabs. The inspector is a normal React overlay, not an SVG `foreignObject`, so text editing, diagnostics, scrolling, keyboard focus, and accessibility remain reliable at all canvas zoom levels.

Theme controls edit a local structured draft. The raw tab uses the existing code editor primitives with YAML/Markdown highlighting, diagnostics, copy, and unsaved state. Switching tabs never silently normalizes or discards raw changes.

- `Save` validates and persists DESIGN.md, then the watcher/commit path updates the specimen and agent context.
- `Save & Apply` performs Save and additionally maps compatible colors/type/spacing/radius values into the active DesignDocument's native `DesignSystemStore`, updating token-linked native canvas objects in one undoable batch.
- HTML/SVG artifacts are not blindly rewritten. Future generation and implementation prompts immediately receive the new source; explicit agent actions can refactor existing file artifacts.

### 7. Agent and export paths operate on the same source

The `design_system` tool keeps structured operations (`create`, `update`, `apply`, `validate`) but targets root DESIGN.md. Tool patches carry an expected source hash, patch front-matter tokens/sections, preserve unknown content, and return actionable lint diagnostics. The tool does not draw a style-kit artifact.

Design-mode system instructions, bundled design-system skill text, screen generation, multi-page foundation prompts, code implementation, and design validation all say to read root DESIGN.md first when present. Implementation provenance hashes the exact valid source.

`design.export` writes `.kun-design/HANDOFF.md` for Kun's screen/graph handoff and references root DESIGN.md rather than embedding a second competing token table.

### 8. Legacy conversion is explicit and reversible

If root DESIGN.md is missing and `.kun-design/design-system.json` is valid, the UI offers a migration draft. It maps supported tokens to Google sections, converts semantic component properties when possible, and records unmappable rich component-tree details in the internal sidecar and a migration note. The board remains hidden until the migrated root DESIGN.md is saved.

Old `.kun-design/DESIGN.md` handoffs remain importable as handoffs and can be renamed to `.kun-design/HANDOFF.md` on the next export. They are never interpreted as the project theme. Rollback can restore the old reader while leaving root DESIGN.md untouched; the legacy JSON is not deleted automatically.

## Risks / Trade-offs

- **Google's schema is alpha and may change** → Pin an exact adapter version, keep fixtures, expose the supported spec version, and update deliberately.
- **Google component tokens cannot encode Kun canvas trees** → Keep the editor sidecar internal and define one-way semantic mapping for Save & Apply.
- **Structured edits can damage user prose/extensions** → Patch an AST/round-trip representation, preserve unknown content, and regression-test byte-stable untouched sections.
- **Arbitrary CSS values can become a rendering/security surface** → Validate allowed scalar types, reject URL-bearing values, never render raw HTML, and use safe style assignments only.
- **Large DESIGN.md files could slow every watcher event** → Enforce a 512 KiB source limit, debounce/coalesce events, cache by hash, and parse off the hot pointer/render path.
- **External edits can race with the inspector** → Use base-hash compare-and-swap and a visible conflict state.
- **Save & Apply may imply HTML rewriting** → Label its exact scope and keep file-artifact refactoring behind explicit agent actions.
- **Renaming the existing handoff path can break callers** → Centralize constants, provide compatibility reads, migrate tests/export packages, and never delete the old file automatically.

## Migration Plan

1. Introduce the adapter, normalized types, fixtures, lint diagnostics, and root-path constants without changing current rendering.
2. Add the DESIGN.md sync state machine and compatibility detection while the legacy JSON board remains behind a temporary fallback flag.
3. Switch board rendering and inspector to the DESIGN.md model; verify missing/invalid/external-edit behavior.
4. Retarget Agent tools, prompts, implementation hashes, and bundled skill instructions.
5. Move project handoff output to `.kun-design/HANDOFF.md` and add compatibility readers.
6. Add opt-in legacy JSON conversion; do not delete legacy files.
7. Remove the legacy project JSON board fallback after focused migration, renderer, runtime, and packaged-app verification.

Rollback restores the legacy reader/board flag. Root DESIGN.md, old JSON, internal per-document sidecars, and old handoff files remain on disk, so rollback does not discard user data.

## Open Questions

- Whether a future release should rename nested artifact `DESIGN.md` notes to `NOTES.md`; this change keeps them compatible and scopes discovery to the workspace root.
- Whether future Google spec versions add a standard mode/theme extension. Until then, light/dark preview mode remains Kun viewer state rather than a custom normative token.
