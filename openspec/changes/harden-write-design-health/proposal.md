## Why

Write mode can currently apply late saves, file reads, reviews, rich-editor rewrites, and image-paste completions to a newer document context. Design mode has stronger modular boundaries, but several persistence paths report success after an `ok: false` result, session-global state can leak across workspaces, and decoded image data has no memory bound. These defects can cause silent data loss, cross-document edits, ghost artifacts, and long-session renderer memory growth.

## What Changes

- Bind every asynchronous Write operation to an immutable workspace, file, and document revision context before it may mutate editor or save state.
- Serialize Write saves per file, keep newer edits dirty after an older save completes, and prevent out-of-order file opens from winning.
- Bind pending agent reviews, rich inline edits, and clipboard-image insertions to their originating document.
- Centralize Design workspace writes behind checked result handling, per-path ordering, observable errors, and explicit flushing for debounced durable state.
- Bound Design image-source caching by entry count and decoded byte cost, with workspace-scoped invalidation.
- Scope Design rehydration tombstones and generations by workspace and reject late hydration results.
- Validate persisted Canvas object graphs before loading them into recursive canvas operations.
- Reduce the highest-risk Write workspace orchestration surface and add regression coverage for all newly enforced invariants.

## Capabilities

### New Capabilities

- `write-workspace-integrity`: Guarantees that file navigation, saving, reviews, AI rewrites, and clipboard-image completion cannot mutate a different or newer Write document context.
- `design-workspace-durability`: Guarantees checked and flushable Design persistence, workspace-isolated hydration state, bounded image memory, and structurally valid persisted Canvas graphs.

### Modified Capabilities

None.

## Impact

- Renderer Write workspace store, file actions, editor orchestration, CodeMirror and TipTap image-paste paths, and related tests.
- Renderer Design workspace store, document/artifact/canvas/design-system persistence, export panels, image resolution, hydration, Canvas parsing, and related tests.
- Shared renderer-internal state types; no external HTTP or Kun runtime protocol break is intended.
- Electron IPC schemas remain compatible; callers will handle existing result unions more strictly.
