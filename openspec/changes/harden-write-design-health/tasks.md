## 1. Write Document Integrity

- [x] 1.1 Add active-document epoch, content revision, and persisted baseline fields plus context helpers to the Write workspace state.
- [x] 1.2 Add a per-workspace/file save coordinator and make `flushSave` preserve newer dirty revisions and isolate late failures/completions.
- [x] 1.3 Fence workspace initialization, directory loads, settings selection, and file opens against stale or out-of-order responses.
- [x] 1.4 Bind pending agent reviews to workspace, path, and document epoch and reject stale review consumption.
- [x] 1.5 Bind rich/source inline edits and infographic completion to their originating document context.
- [x] 1.6 Bind CodeMirror and TipTap clipboard-image completions to their originating document epoch.
- [x] 1.7 Add deterministic Write store/editor regression tests for concurrent opens, edit-during-save, cross-file completion, stale review, stale rich rewrite, and stale paste.

## 2. Write Lifecycle Structure

- [x] 2.1 Extract autosave, unmount flush, file-watch, and pending-review orchestration from `WriteWorkspaceView` into a focused hook.
- [x] 2.2 Add focused tests for the extracted lifecycle context predicates and verify `WriteWorkspaceView` no longer owns those effects directly.

## 3. Design Persistence

- [x] 3.1 Implement a checked, per-path ordered Design write/delete coordinator with failure publication and queue flushing.
- [x] 3.2 Route document-index and artifact metadata persistence through the coordinator and retain flushable pending index payloads per workspace.
- [x] 3.3 Route Canvas and design-system persistence through the coordinator and expose workspace-scoped debounce flush functions.
- [x] 3.4 Register Design persistence failures with the active workspace store and flush pending durable state on Design lifecycle teardown/workspace change.
- [x] 3.5 Make Design contract and interoperability exports inspect resolved write failures before reporting success.
- [x] 3.6 Make initial Design board creation transactional and avoid registering an artifact when its file write fails.
- [x] 3.7 Add persistence tests for resolved failures, thrown failures, per-path ordering, debounce flush, export failure UI, and board rollback.

## 4. Design Resource And Workspace Isolation

- [x] 4.1 Replace the Design image Data URL Map with a byte-aware LRU and add workspace-scoped clearing/statistics.
- [x] 4.2 Replace global hydration tracking sets with bounded workspace-keyed registries.
- [x] 4.3 Add hydration generation/workspace fencing and reset projected/transient state safely when the Design workspace changes.
- [x] 4.4 Add tests for LRU eviction, workspace cache clearing, same-ID workspace isolation, and late hydration rejection.

## 5. Canvas Document Safety

- [x] 5.1 Add finite geometry and bounded object/child validation to persisted Canvas parsing.
- [x] 5.2 Add iterative rooted graph validation for missing children, duplicate/multiple parents, parent mismatch, or cycles.
- [x] 5.3 Replace recursive v1 coordinate migration with validated iterative traversal.
- [x] 5.4 Add Canvas parser tests for malformed graphs, limits, and valid v1 migration.

## 6. Verification And Handoff

- [x] 6.1 Run Write and Design focused tests and resolve every newly introduced or exposed failure.
- [x] 6.2 Run root typecheck, full unit tests, lint, Kun build, and application build.
- [x] 6.3 Audit every proposal/spec requirement against current source and test evidence and record the result.
- [x] 6.4 Commit the completed change locally with an Angular-style commit message while preserving unrelated user files.
