## 1. Baseline and ownership guardrails

- [x] 1.1 Record full Kun/root typecheck, test, and build baselines and separate
  concurrent-work failures from hotspot behavior.
- [x] 1.2 Add deterministic lifecycle, protocol, event-projection, workflow-run,
  persistence, and UI-interaction characterization fixtures where coverage is weak.
- [x] 1.3 Document public import paths, HTTP/SSE contracts, persisted formats,
  provider request transcripts, and settings shapes that must remain compatible.

## 2. Main runtime supervision

- [x] 2.1 Extract the Kun child process state and single-flight start/stop ownership
  from module globals into a `KunProcessController` while preserving exports.
- [x] 2.2 Extract readiness polling, health probing, startup timeout, and unexpected
  exit policy behind a runtime health monitor.
- [x] 2.3 Extract generated-config and hot-apply/restart decision logic behind a
  runtime configuration service.
- [x] 2.4 Introduce a main-process runtime supervisor for ensure, restart, watchdog,
  and settings-apply serialization.
- [x] 2.5 Extract application shutdown coordination and prove no runtime can restart
  after quit begins.
- [x] 2.6 Reduce `main/index.ts` and `kun-process.ts` to bootstrap/facade composition
  and remove duplicated lifecycle state.

## 3. Compatible model protocol boundaries

- [x] 3.1 Capture representative Chat Completions, Responses, and Anthropic Messages
  request/header/stream/usage transcripts.
- [x] 3.2 Extract shared stream resource budgeting and tool-call aggregation.
- [x] 3.3 Extract Chat Completions request codec and stream decoder.
- [x] 3.4 Extract Responses request codec and stream decoder.
- [x] 3.5 Extract Anthropic Messages request codec and stream decoder.
- [x] 3.6 Extract shared usage normalization, retry classification, and diagnostics.
- [x] 3.7 Reduce `CompatModelClient` to endpoint selection, transport, and common
  orchestration and verify byte-equivalent requests.

## 4. Claw and IM boundaries

- [x] 4.1 Characterize existing conversation/thread reuse, attachments, streaming
  reply, mirror, fallback, and per-channel failure behavior.
- [x] 4.2 Extract channel-independent conversation registry and Kun thread binding.
- [x] 4.3 Extract IM attachment authorization/upload and reply pipeline.
- [x] 4.4 Extract Feishu transport adapter.
- [x] 4.5 Extract Telegram transport adapter.
- [x] 4.6 Extract Weixin transport adapter and legacy session compatibility.
- [x] 4.7 Reduce `ClawRuntime` to channel coordination and remove platform branches
  from common conversation logic.

## 5. Renderer event projection

- [x] 5.1 Capture live, replay, reconnect, duplicate completion, approval/user-input,
  child-agent, goal/todo, and workspace-refresh projections.
- [x] 5.2 Introduce normalized runtime projection action types.
- [x] 5.3 Extract pure item/event-to-action normalization from `kun-mapper`.
- [x] 5.4 Extract a pure chat projection reducer shared by live SSE and replay.
- [x] 5.5 Represent notifications, reconnect, reload, mirror, and workspace refresh as
  explicit effect commands with once-only tests.
- [x] 5.6 Reduce `chat-store-runtime` and `kun-mapper` to wiring/facade roles.

## 6. Workflow execution and configuration

- [x] 6.1 Capture graph order, branching, retries, approval, cancellation, timeout,
  schedule, hook, and single-node execution transcripts.
- [x] 6.2 Extract graph planner and validated execution plan types.
- [x] 6.3 Extract run coordinator and terminal-state/cancellation ownership.
- [x] 6.4 Introduce a typed node executor registry and move AI, HTTP, condition,
  transform, delay, and integration node families behind adapters.
- [x] 6.5 Extract workflow scheduler and live-status projection.
- [x] 6.6 Split `NodeConfigPanel` into node-family editors with shared binding and
  validation components.
- [x] 6.7 Reduce `WorkflowRuntime` and the shared panel to composition facades.

## 7. Hybrid thread persistence

- [x] 7.1 Add golden existing-data fixtures covering SQLite index, JSONL history,
  legacy threads, backfill, archive/search, and usage recovery.
- [x] 7.2 Extract thread index repository and query/summary mapping.
- [x] 7.3 Extract thread document/legacy readers and recovery precedence.
- [x] 7.4 Extract thread projection assembler and turn/item merge rules.
- [x] 7.5 Extract backfill coordination and lifecycle/error reporting.
- [x] 7.6 Reduce `HybridThreadStore` to the `ThreadStore` facade and prove persisted
  schema and files remain unchanged.

## 8. Workbench UI composition

- [x] 8.1 Characterize Composer draft, attachment, mention, keyboard, menu,
  model/reasoning, capacity, send, and focus behavior.
- [x] 8.2 Extract Composer draft/attachment/file-mention hooks and focused views.
- [x] 8.3 Extract Composer model/reasoning/menu/capacity owners and preserve the
  public props contract.
- [x] 8.4 Characterize Sidebar grouping, worktree resolution, drag/drop, preview,
  draft history, menus, and selection behavior.
- [x] 8.5 Extract deterministic Sidebar selectors and focused project/thread/draft
  components.
- [x] 8.6 Verify keyboard-only and accessibility behavior for extracted UI.

## 9. Settings domain contract

- [x] 9.1 Inventory every persisted settings field across shared types, defaults,
  normalization, migration, IPC schemas, presets, and UI patches.
- [x] 9.2 Establish canonical domain modules for provider/Kun/runtime settings rules.
- [x] 9.3 Route IPC schemas and main consumers through canonical normalizers.
- [x] 9.4 Route provider and agent settings UI patches through canonical helpers and
  split node-size settings sections into focused panels.
- [x] 9.5 Verify all supported legacy settings fixtures normalize and save to the same
  current shape without restoring legacy runtimes.

## 10. Final compatibility and health audit

- [x] 10.1 Run focused tests and build/typecheck after every extraction increment.
- [x] 10.2 Run the full Kun and root test suites, typechecks, lint, and production
  build, documenting unrelated concurrent failures separately.
- [x] 10.3 Compare public exports, HTTP/SSE schemas, provider wire transcripts, tool
  schemas/cache prefix, persisted files, and saved settings against the baseline.
- [x] 10.4 Perform local runtime startup/health/shutdown and core Code/Design/Write/
  Connect smoke checks appropriate to the available environment.
- [x] 10.5 Confirm each former S/A hotspot has a narrow owner, no duplicated active
  path, adequate characterization coverage, and a documented remaining risk.
