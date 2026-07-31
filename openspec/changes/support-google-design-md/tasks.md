## 1. Protocol and dependency foundation

- [x] 1.1 Add and pin the supported `@google/design.md` alpha package behind a Kun adapter boundary; document the pinned schema version and update the lockfile.
- [x] 1.2 Introduce canonical path constants for root `DESIGN.md`, `.kun-design/HANDOFF.md`, legacy `.kun-design/DESIGN.md`, and legacy `.kun-design/design-system.json`.
- [x] 1.3 Define normalized DESIGN.md document, token, diagnostic, draft, conflict, and sync-state types without exposing package-specific types outside the adapter.
- [x] 1.4 Add official-style fixtures, the provided Luminous Stage fixture, invalid/unsafe fixtures, and size-boundary fixtures.

## 2. Google-compatible parsing and round-trip editing

- [x] 2.1 Parse YAML front matter and ordered Markdown sections into the normalized model, including colors, typography, rounded, spacing, components, extensions, and source hash.
- [x] 2.2 Integrate official lint findings and Kun safety checks for malformed fences, duplicate sections, broken references, CSS values, contrast, section order, and 512 KiB/truncated sources.
- [x] 2.3 Implement safe token-reference resolution with cycle/depth guards and normalized color/dimension/typography conversion for preview and canvas consumers.
- [x] 2.4 Implement AST/round-trip structured patches that preserve unknown YAML keys, untouched Markdown prose, extension sections, and original token values.
- [x] 2.5 Add parser/serializer tests for official examples, Luminous Stage, unknown content, invalid revisions, reference cycles, unsafe values, and byte-stable untouched sections.

## 3. Root file lifecycle and state machine

- [x] 3.1 Replace project JSON sync with root DESIGN.md discovery states for loading, missing, ready, dirty, invalid, conflict, and saving while retaining the last valid model.
- [x] 3.2 Add workspace/document context fences, bounded reads, source-size/truncation checks, atomic-rename watcher recovery, event coalescing, deletion handling, and sender cleanup.
- [x] 3.3 Implement base-hash compare-and-swap saves, duplicate-save coalescing, external-edit conflict recovery, and failure rollback.
- [x] 3.4 Ensure missing DESIGN.md creates no board, layer, artifact, placeholder, polling leak, or stale public token state.
- [x] 3.5 Add lifecycle tests for initial load, missing/invalid files, atomic replacement, deletion/recreation, workspace switches, stale async completion, conflicts, and write failures.

## 4. Deterministic theme specimen board

- [x] 4.1 Replace the current project JSON board renderer with a DESIGN.md specimen model that selects featured roles and deterministic fallbacks.
- [x] 4.2 Build safe palette cards and non-persisted tonal ramps for primary, secondary, tertiary, neutral/surface, and supplemental colors.
- [x] 4.3 Build typography, surface, control, input/search, progress, navigation, action/chip, rounded, spacing, and semantic component sample sections.
- [x] 4.4 Preserve canvas-coordinate placement, zoom/pan behavior, artifact-portal layering, stable ordering, selection affordance, and exclusion from the normal Layers list.
- [x] 4.5 Add rendering/model tests for Luminous Stage, sparse/arbitrary token names, extra tokens, reference errors, safe fallbacks, repeated mounts, and file deletion.

## 5. Theme and raw DESIGN.md inspector

- [x] 5.1 Add a right-side inspector opened from the specimen with accessible `Theme` and `DESIGN.md` tabs and responsive bounded layout.
- [x] 5.2 Implement draft-only theme controls for preview mode, seed/semantic colors, typography, rounded, spacing, and component token properties.
- [x] 5.3 Implement raw YAML/Markdown editing with syntax highlighting, diagnostics, copy, dirty state, and exact draft preservation across tab switches.
- [x] 5.4 Implement Save and Save & Apply enablement, progress, success/error, conflict resolution, and unsaved-close protection.
- [x] 5.5 Add inspector interaction tests for keyboard navigation, invalid raw edits, tab switching, external watcher updates, save conflicts, and narrow-window layout.

## 6. Mapping and Save & Apply behavior

- [x] 6.1 Map compatible DESIGN.md colors, typography, spacing, and rounded values into Kun native design tokens without overwriting internal rich component trees.
- [x] 6.2 Apply mapped tokens to token-linked native canvas objects in one undoable batch and preserve unrelated fills, strokes, text, geometry, and portal nodes.
- [x] 6.3 Update active design context and future HTML/SVG generation inputs while explicitly avoiding silent rewrites of existing file artifacts.
- [x] 6.4 Add mapping/apply tests for supported values, arbitrary names, unresolved references, partial compatibility, undo, and HTML/SVG non-mutation.

## 7. Agent tools, prompts, and validation

- [x] 7.1 Retarget the Kun `design_system` tool create/update/apply/validate contract to root DESIGN.md with expected-hash conflict protection and structured diagnostics.
- [x] 7.2 Update Design-mode system prompts and intent routing so agents read root DESIGN.md first, patch it structurally, preserve prose, and never draw a separate style-kit artifact.
- [x] 7.3 Update bundled design-system skill instructions, screen/multi-page foundation prompts, validation, code implementation, and design-from-code paths to consume the same valid source.
- [x] 7.4 Hash exact valid DESIGN.md source for implementation provenance and drift detection; omit design-system claims when no valid source exists.
- [x] 7.5 Add native and Agent SDK tests for tool advertisement, allowed operations, stale revisions, validation recovery, prompt paths, source hashes, and missing/invalid sources.

## 8. Handoff path and legacy migration

- [x] 8.1 Change Kun project handoff writers/packages from `.kun-design/DESIGN.md` to `.kun-design/HANDOFF.md` and reference root DESIGN.md rather than duplicating token tables.
- [x] 8.2 Add compatibility readers for old `.kun-design/DESIGN.md` handoffs without treating them as the project theme.
- [x] 8.3 Build non-destructive legacy JSON conversion into a Google-compatible migration draft, including supported token mapping, internal rich-tree preservation, and migration notes.
- [x] 8.4 Ensure legacy JSON alone never renders a board; save root DESIGN.md only after explicit migration acceptance and never delete the legacy file automatically.
- [x] 8.5 Update import/export, resource-surface, Penpot/code handoff, file-index, localization, and migration tests for the new path semantics.

## 9. End-to-end verification and cleanup

- [x] 9.1 Remove obsolete project JSON board code, strings, prompt references, and dead persistence paths while retaining documented internal per-document sidecars.
- [x] 9.2 Run focused parser, watcher, board, inspector, canvas, tool-protocol, runtime, implementation, and migration test suites plus TypeScript and lint checks.
- [x] 9.3 Run the complete Design-mode test suite and production build, separating unrelated baseline failures from regressions.
- [x] 9.4 Verify in a real Electron workspace that a Google/Stitch DESIGN.md auto-renders, raw and Theme edits round-trip, Save & Apply updates native tokens, external atomic saves refresh, invalid edits retain last-valid preview, and deletion removes the board.
- [x] 9.5 Verify a workspace without DESIGN.md shows no design-system UI and that old JSON/handoff/artifact-note files are preserved without becoming competing sources.
