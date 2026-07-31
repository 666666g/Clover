## Context

`ProvidersSettingsSection` currently combines provider selection and every provider/global control in a single 2,200-line component. Its two-column layout is constrained by the settings page's `max-w-3xl` wrapper, while the active provider detail grows through connection, retry, model, five media capabilities, draft actions, deletion, and global proxy settings. Existing provider edits use the SettingsView debounce/auto-save path; only newly added providers are local drafts. Model editing adds another long inline form inside the provider detail.

The redesign must preserve all provider profiles and specialized Codex/Claude subscription flows, keep `window.kunGui.probeModelProvider` unchanged, and stay within the existing design tokens and localization system.

## Goals / Non-Goals

**Goals:**

- Make provider selection and provider-scoped tasks easy to locate without removing advanced functionality.
- Preserve the established auto-apply model while making save and connection states distinct.
- Make provider creation and model editing focused, cancelable flows.
- Support compact settings windows, long provider/model names, large model catalogs, dark mode, and all shipped locales.

**Non-Goals:**

- Changing provider/profile schemas, runtime selection, endpoint semantics, probe IPC, or request behavior.
- Adding provider logos, external assets, or dependencies.
- Restoring legacy agent/provider switchers or runtime diagnostics surfaces.

## Decisions

1. **Use a master-detail workspace with task tabs.** The provider list remains available on wide layouts, while the detail uses `connection`, `models`, `capabilities`, and `advanced` tabs. This preserves fast cross-provider work and avoids a nested route or wizard for routine edits. The active tab remains stable across provider selection; creating a draft opens `connection`.

2. **Widen only the provider category.** `SettingsView` will use a larger content maximum for the provider category while other settings sections retain their current width. At compact widths the provider list becomes a select control above the detail, avoiding an unusably narrow form.

3. **Keep persisted provider edits auto-applied and drafts explicit.** Existing controls continue calling the current `update` path. The provider detail receives the existing global save state for visible feedback. A new provider remains in local state and uses a sticky, always-visible confirmation bar; canceling discards it.

4. **Replace the add dropdown with a searchable modal.** Presets are grouped by subscription/API and can be searched by label. Existing presets expose their update state, and a custom-provider entry remains available. The modal owns focus, closes on Escape/backdrop/cancel, and returns focus to its trigger.

5. **Use progressive disclosure for dense controls.** Connection contains the fields needed to become usable. Capabilities are summary cards whose detailed protocol/base URL/model controls open only when enabled. Retry, provider ID, and deletion live in Advanced. Global proxy is a collapsed page-level section outside active-provider content.

6. **Move model forms into a dialog.** The unified searchable/paginated list remains embedded in the Models tab, but add/edit uses a modal dialog. Common identity and capability fields render first; reasoning protocol, endpoint override, aliases, context, and output settings are grouped without changing the underlying editor helpers or validation.

7. **Derive status instead of persisting it.** Provider readiness comes from required credentials and URL validity. Probe state remains keyed by the connection fingerprint so edits invalidate stale results. Save state comes from SettingsView. No new settings fields are introduced.

## Risks / Trade-offs

- **[Risk] Tabs can hide advanced controls users previously found by scrolling.** → Use explicit labels, capability counts/status summaries, and keep all controls reachable within one click.
- **[Risk] Provider-specific save feedback could imply per-provider persistence.** → Label it as settings auto-apply state and keep probe state visually separate.
- **[Risk] Dialogs can regress keyboard accessibility.** → Use semantic dialogs, focus containment/restoration, Escape handling, labeled controls, and targeted tests.
- **[Risk] A category-specific width change can affect settings layout.** → Apply the wider wrapper only when `category === 'providers'` and manually verify compact and wide windows.
- **[Risk] Refactoring a large stateful component can alter settings behavior.** → Reuse update/probe/draft helper functions, add behavior tests around drafts and provider switching, and run the full renderer validation suite.

## Migration Plan

No data migration is required. The redesign reads and writes the same settings objects. Rollback consists of reverting renderer changes; persisted provider data remains compatible.

## Open Questions

None.
