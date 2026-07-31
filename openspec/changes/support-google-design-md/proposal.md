## Why

Kun currently treats `.kun-design/design-system.json` as the project design-system source and exports a separate `.kun-design/DESIGN.md` handoff document that does not follow Google's DESIGN.md schema. This creates two competing sources of truth and prevents a DESIGN.md created by Stitch or another coding agent from appearing automatically on the Design whiteboard.

Google has now published the alpha DESIGN.md specification, which combines normative YAML design tokens with Markdown rationale. Adopting that interoperable format gives Kun one human-readable, agent-readable project contract that can drive the built-in design-system board, generation prompts, validation, and code handoff.

## What Changes

- Make workspace-root `DESIGN.md` the canonical public project design-system file and automatically discover, watch, parse, validate, and render it on the Design whiteboard.
- Render a fixed, Google-Stitch-style theme specimen from DESIGN.md instead of asking an agent to draw a style-kit artifact. The specimen includes color ramps, typography, controls, navigation, progress, surfaces, shapes, and component token examples.
- Add a design-system inspector with `Theme` and `DESIGN.md` tabs. Theme edits update a validated draft; raw Markdown edits preserve unknown tokens and sections. `Save` persists the file, while `Save & Apply` also updates the current structured canvas theme and token-linked native objects.
- Use Google's alpha token model for colors, typography, rounded, spacing, and component properties, including token references, unknown-extension preservation, structural diagnostics, broken-reference checks, and WCAG contrast findings.
- Update the Design agent and code-handoff prompts/tools to read root `DESIGN.md` first and to create or patch that file with structured operations while preserving its prose.
- **BREAKING**: stop publishing the Kun project handoff to `.kun-design/DESIGN.md`; publish it as `.kun-design/HANDOFF.md` so `DESIGN.md` has one unambiguous project-level meaning. Existing handoff files remain readable during migration.
- Treat `.kun-design/design-system.json` as a legacy import source only. When no root DESIGN.md exists, a valid legacy file can be converted once without showing a board before the user accepts or saves the migrated DESIGN.md.
- Keep per-document rich canvas component-tree JSON as internal editor state because Google's alpha component schema does not represent Kun canvas trees. It must not independently trigger the project design-system board or override root DESIGN.md.

## Capabilities

### New Capabilities

- `google-design-md-source`: Workspace-root DESIGN.md discovery, Google-compatible parsing, validation, watching, editing, persistence, migration, and agent/code-handoff consumption.
- `design-md-theme-board`: Deterministic whiteboard specimen rendering, theme/raw inspector behavior, draft/save/apply semantics, error states, and safe conversion into Kun canvas tokens.

### Modified Capabilities

None. This repository has no baseline OpenSpec capabilities yet.

## Impact

- Renderer design-system model, persistence, file watcher, whiteboard overlay, canvas properties/selection, Design sidebar, inspector UI, Design agent prompts, export/import, implementation roundtrip, and associated tests.
- Kun `design_system` tool contract and bundled design-system skill instructions.
- Project handoff path constants and compatibility readers for `.kun-design/DESIGN.md`.
- A pinned adapter around the official `@google/design.md` alpha linter/schema, plus YAML front-matter serialization that preserves unknown keys and Markdown sections.
- Migration coverage for existing `.kun-design/design-system.json`, existing `.kun-design/DESIGN.md` handoffs, and per-artifact DESIGN.md notes.
