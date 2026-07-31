## Context

Write mode has one active-document Zustand store, but its persisted baseline is module-global and its async operations do not share a common document identity. A late file read, save completion, review event, AI response, or clipboard-image result can therefore mutate whatever document is active when it resolves. The largest orchestration component also owns persistence, watching, editing, export, and generation lifecycles, which makes these invariants difficult to test.

Design mode already has strong context fencing for project `DESIGN.md`, preview watchers, and SVG preparation. Its remaining durability paths are less consistent: direct IPC writes are spread across stores and panels, several callers ignore resolved failure results, debounced writers cannot all be flushed, hydration session markers are global, decoded image strings are retained without bounds, and persisted Canvas graphs are trusted before recursive traversal.

The renderer remains the owner of these UI workflows. Existing Electron IPC payloads and the Kun runtime contract must remain compatible.

## Goals / Non-Goals

**Goals:**

- Make the active Write document an explicit identity consisting of workspace root, file path, and monotonically increasing epoch/revision.
- Ensure saves are ordered per file and that late completions cannot mark newer content or another file as saved.
- Make all Write review, AI, and image-paste completions context-safe.
- Give Design persistence one checked, ordered write primitive and flush every debounced durable state source.
- Surface Design persistence failures instead of silently treating them as success.
- Bound decoded Design image memory and isolate hydration tracking by workspace.
- Reject malformed or cyclic Canvas graphs before recursive consumers see them.
- Extract persistence/watcher orchestration from `WriteWorkspaceView` and cover the new boundaries with deterministic tests.

**Non-Goals:**

- Changing Kun HTTP/SSE behavior, provider request formats, or public Electron IPC schemas.
- Replacing CodeMirror, TipTap, the Canvas renderer, or the official `DESIGN.md` adapter.
- Redesigning Write or Design user-facing layouts.
- Persisting undo history or image caches across application restarts.

## Decisions

### 1. Write uses an explicit active-document epoch and content revision

The Write store will own `documentEpoch`, `contentRevision`, and `persistedContent`. Opening, clearing, renaming away from, or switching the active document advances the epoch. Local content mutations advance the content revision. Async operations capture `{ workspaceRoot, filePath, documentEpoch }` and must match it before mutating active state.

This is preferred over path-only checks because a user can leave a file and reopen the same path while an older operation is still pending. It is preferred over AbortController alone because Electron IPC and already-started disk writes cannot always be cancelled.

### 2. Write saves are serialized per workspace and file

A small save coordinator will queue writes by normalized workspace/path. Each queued write captures content and revision. A successful write updates the active persisted baseline only when its document epoch still matches; if newer content exists, the state remains dirty and the latest content is queued before a navigation flush may succeed. Failures never mutate a different document.

Per-file ordering is preferred over a single global queue because independent workspaces/files should not block each other. Optimistic `saved` state is rejected because it creates a data-loss window.

### 3. Review and editor jobs carry their origin context

Pending agent reviews will include workspace, path, and document epoch. Rich inline edits, infographic jobs, and CodeMirror/TipTap clipboard-image jobs capture the same context. Result application requires both matching context and the existing content/range precondition. A stale job may finish external work for its original file, but it cannot edit the current editor.

### 4. Design persistence uses a checked per-path coordinator

A renderer-internal coordinator will normalize thrown exceptions and resolved `{ ok: false }` responses, serialize writes by workspace/path, publish failures to the active Design store, and expose a queue flush. Export panels and transactional artifact creation will await and inspect the checked result. Debounced document-index, Canvas, and design-system writers will retain pending payloads and expose workspace-scoped flush functions.

This preserves existing IPC contracts while removing duplicated success/error interpretation. A new main-process protocol is unnecessary.

### 5. Design image caching uses a byte-aware LRU

Resolved workspace image Data URLs will be cached with both an entry limit and a conservative string-byte budget. Hits refresh recency, insertion evicts oldest entries, and workspace switches/resets can clear matching keys. Failed reads remain uncached.

An LRU is preferred over no cache because canvas rerenders otherwise repeat expensive IPC/base64 conversion. A count-only bound is insufficient because permitted images vary greatly in size.

### 6. Hydration tracking is keyed by normalized workspace

Removed artifact IDs, removed document IDs, and user-created document IDs will live in bounded workspace-keyed registries. Rehydration captures a generation and checks both generation and workspace before every state commit. Changing the Design workspace resets projected state, invalidates the previous hydration generation, clears transient canvas/image state, and begins from the new root.

### 7. Canvas parsing validates graph integrity iteratively

Before returning a `CanvasDocument`, parsing will enforce object-count/child-count limits, finite geometry, a present root, existing unique children, matching parent pointers, single reachability from the root, and no cycles. V1 coordinate migration will use an iterative traversal after validation. Invalid documents return `null` and existing reconstruction/error behavior handles recovery.

### 8. High-risk Write lifecycle code moves behind focused modules

Autosave, unmount flush, file watching, and pending-review consumption will move from `WriteWorkspaceView` into a focused hook/coordinator with pure context predicates. Export and editing UI remain in the view unless moving them materially improves the enforced invariant. The target is a meaningful reduction in mixed lifecycle responsibilities, not an arbitrary line-count rewrite.

## Risks / Trade-offs

- [Risk] A navigation flush can take longer because it waits for the latest revision, not just the first queued write. → Mitigation: serialize only per file and keep ordinary autosave debounced.
- [Risk] More explicit Write state fields duplicate active content metadata. → Mitigation: the prior implementation already retained a full module-global baseline; the new state makes ownership observable and testable without increasing the number of retained document copies.
- [Risk] Surfacing Design persistence errors may expose failures that were previously invisible. → Mitigation: retain in-memory state and present a recoverable error; do not claim success or discard the draft.
- [Risk] Strict Canvas validation may reject historically malformed documents that happened to render. → Mitigation: retain tolerant field defaults, reject only structurally unsafe graphs, and fall back to artifact reconstruction.
- [Risk] A bounded image cache may cause extra IPC reads after eviction. → Mitigation: use practical entry/byte limits and LRU recency so visible/recent images stay hot.

## Migration Plan

1. Add context/revision fields with defaults so existing Write state initializes without persisted migration.
2. Route Write file actions and editor jobs through context checks and add regression tests before extracting the view lifecycle hook.
3. Add the Design persistence coordinator, migrate internal writers/panels, and add flush cleanup.
4. Replace global hydration sets and image Map behavior without changing on-disk formats.
5. Add Canvas validation while preserving version 1 to version 2 coordinate migration.
6. Run focused tests after each area, then full typecheck, test, lint, Kun build, and application build.

Rollback is code-only: no on-disk schema is changed. Reverting the implementation restores prior behavior, while files written by the new coordinator remain compatible.

## Open Questions

None. Limits will be encoded as named constants and covered by tests so they can be tuned without changing the contract.
