## Why

Kun's Code composer currently combines model selection and reasoning effort in one control, even though they are separate decisions with different change frequency and meaning. Splitting them makes each choice immediately legible and gives reasoning a focused, visual interaction without forcing users through the model menu for a routine adjustment.

## What Changes

- Change the Code composer only: replace the combined model-and-reasoning trigger with two adjacent, borderless text controls for the provider/model and reasoning effort.
- Keep provider grouping, model search, capability badges, setup guidance, and vision-switch safeguards in the model menu only.
- Add a dedicated, borderless reasoning popover with `更快` / `更智能` endpoints, a vivid blue-to-magenta energy rail, white thumb, animated bubbles, layered sweep light, and visible stop nodes.
- Map all currently supported reasoning efforts to evenly distributed discrete stops; map `auto` to the far-right stop and show effort names only in the composer trigger.
- Keep the model and reasoning controls operable during an active turn; changes configure the next submitted turn and do not alter the request already in flight.
- Keep `off`, `low`, and `medium` visually calm with a static blue fill; enable the seamless color loop, sweep light, and bubbles only for `high`, `max`, and `auto`, with reduced-motion and dark-theme behavior.
- Persist the selected reasoning effort independently for each provider/model pair, including an explicit `off`, while preserving model-aware normalization and runtime request semantics.

## Capabilities

### New Capabilities

- `composer-model-reasoning-controls`: Defines Code-only separate model and reasoning controls, including visible discrete effort nodes, responsive layouts, motion, accessibility, and session-state expectations.

### Modified Capabilities

None.

## Impact

- Renderer: `FloatingComposer`, `FloatingComposerModelPicker`, Code composer props, related placement/state helpers, and base-shell styling.
- State/contracts: move `composerReasoningEffort` into the chat store and add a renderer-local, versioned provider/model preference registry; no preload, main-process, Kun HTTP, SSE, or app-settings schema change is required.
- Tests: component rendering, menu placement, rail mapping, supported-effort normalization, model switching, reduced motion, and keyboard/ARIA behavior.
- Design: a new Kun composer visual treatment for the reasoning trigger and its popover in light and dark themes.
