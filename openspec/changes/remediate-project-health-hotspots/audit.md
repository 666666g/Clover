# Final Health and Compatibility Audit

Recorded on 2026-07-11 against baseline commit
`8be127fcef8de30dcc09044e477fa5bfad1bc2ae` and the final local `develop`
revision.

## Outcome

All former S/A hotspots now have one state owner for their load-bearing state
machine. Compatibility facades remain at the existing import paths, duplicate
active paths were removed, and the final root/Kun gates are green. The later B
audit found and fixed additional shutdown, cache-growth, and stale-response
defects rather than splitting files solely to reduce line count.

The Kun Agent Loop is 785 lines. It remains the turn orchestration facade while
model stepping, tool execution, round outcomes, history compaction, attachments,
model routing, goals, titles, budgets, telemetry, and turn finalization have
separate owners. Its remaining size is orchestration breadth, not duplicated
mutable ownership.

## Hotspot size and ownership review

| Former hotspot | Baseline | Final | Reduction | Current narrow owners | Remaining risk |
| --- | ---: | ---: | ---: | --- | --- |
| `src/main/index.ts` | 1,962 | 1,691 | 14% | `KunRuntimeSupervisor`, `ManagedRuntimeOperationCoordinator`, `KunProcessController`, `KunRuntimeHealthMonitor`, runtime config service, shutdown coordinator | Electron window/tray/updater bootstrap is still broad, but runtime lifecycle state is no longer owned here. |
| `src/main/kun-process.ts` | 1,798 | 691 | 62% | process controller, health monitor, config projectors | Compatibility facade still contains launch/config glue. |
| `src/main/claw-runtime.ts` | 3,515 | 2,426 | 31% | conversation registry, IM router, Feishu/Telegram/Weixin adapters and inbound coordinators, attachment pipeline, welcome coordinator | Common webhook/prompt/result coordination remains integration-heavy; channel state and shutdown are isolated. |
| `CompatModelClient` | 3,348 | 1,191 | 64% | endpoint request codecs; Chat, Responses, and Messages stream decoders; shared resource budget, usage, retry, and diagnostics | The facade still owns common transport/retry/stream orchestration by design. |
| `chat-store-runtime.ts` | 1,495 | 1,043 | 30% | normalized projection actions, pure reducer, explicit effect planner, per-stream sink | Browser effects remain in the sink boundary; projection state has one reducer. |
| `kun-mapper.ts` | 1,460 | 1,368 | 6% | event normalizer plus pure item-family mapping; sink dispatcher only applies normalized actions | Mapping volume remains high, but it owns no store state and no duplicate reducer. |
| `workflow-runtime.ts` | 2,335 | 1,153 | 51% | graph planner/executor, run coordinator, scheduler, typed node registry/adapters | Facade still composes persistence and public runtime calls. |
| `NodeConfigPanel.tsx` | 2,377 | 967 | 59% | node-family editors and shared editor primitives | Cross-family layout remains in the facade. |
| `HybridThreadStore` | 1,382 | 817 | 41% | index repository, document/legacy repository, projection assembler, backfill coordinator | Facade intentionally remains the single SQLite/schema and metadata-queue writer. |
| `FloatingComposer.tsx` | 2,765 | 1,863 | 33% | draft, user-input, file-mention and slash-command hooks plus focused model/menu/capacity views | Layout and focus coordination remain visually sensitive. |
| `SidebarProjectsSection.tsx` | 2,312 | 1,075 | 54% | deterministic selectors, row views, overlays, section coordinator | Drag/drop and worktree UI integration remain interaction-heavy. |

No second live owner was found for runtime ensure/restart/settings operations,
runtime health probes, workflow run/cancel/approval state, hybrid backfill,
renderer projection state, or Agent Loop per-turn state.

## B-level defects remediated during the final audit

| Area | Defect closed |
| --- | --- |
| Hybrid persistence | Shutdown now cancels and awaits background backfill before SQLite/cache closure. |
| Claw common runtime | Runtime HTTP work, result polling, SSE streaming, delayed pushes, title writes, and fallbacks stop cleanly. |
| IM lifecycle | Feishu connection sync, Telegram poll/inbound work, eager WeChat welcomes, webhook connections, and result pushes are awaited; no post-stop restart/write path remains. |
| Workflow | Active and nested graph nodes receive cancellation; shutdown awaits terminal persistence. |
| Schedule runtime/UI | Queued/running tasks and worktree leases are canceled/released; stale polling responses cannot overwrite newer saves or unmounted state. |
| Weixin bridge | Long polls, account requests, sends, monitor restarts, sender chains, login state, and HTTP connections close on shutdown. |
| LSP tools | Pending and initialized language-server child processes are synchronously reachable and terminated during runtime/process shutdown. |
| Local Whisper | Downloads and runner children are canceled/awaited on quit; cancellation waits for the write pipeline and leaves no live timeout. |
| Renderer projection | Pending child-tool repair state is per stream and bounded, preventing cross-thread projection pollution. |
| Renderer caches | Workspace mention/index caches are LRU/TTL bounded. |
| Transient runtime state | Hook matcher cache, unavailable-Git checkpoint suppression, and worktree task ownership are bounded or released; Git availability retries without app restart. |
| Build graph | Image generation uses one static owner, removing the mixed static/dynamic import warning. |

## Compatibility comparison

- **Public Kun imports:** the diff of all published Kun barrel files (`.`,
  `contracts`, `domain`, `ports`, `adapters`, `loop`, `server`, `cache`,
  `telemetry`, `services`, and `hooks`) against the baseline is empty. A missing
  `InterpScope` type export found during review was restored before this audit.
- **HTTP/SSE:** no route was removed. Legacy unacknowledged SSE remains supported;
  acknowledged batching is additive. Event cursors now reject malformed values
  and unknown threads rather than opening invalid streams. The final real-process
  smoke exercised health, auth, thread list/create/read/fork/archive/search,
  workspace status, and SSE.
- **Provider wire:** Chat Completions, OpenAI Responses, and Anthropic Messages
  URL/header/body/stream/tool/usage/cache/retry transcript suites pass. Request
  codec and decoder selection is isolated by endpoint family.
- **Tool/cache prefix:** canonical tool-order/schema tests, stable-prefix tests,
  volatile-context placement tests, tool-call repair tests, and cache usage
  normalization pass.
- **Persistence:** legacy JSON, SQLite index, JSONL recovery, archive/search,
  usage backfill, and projection golden tests pass. The real hybrid smoke wrote
  `index.sqlite3`, per-thread `events.jsonl`, and `metadata.jsonl`; shutdown left
  no WAL/SHM sidecar.
- **Settings:** shared defaults, canonical domain ownership, normalization,
  migration, IPC stripping, provider presets, and UI patch tests pass. Legacy
  runtime/provider fields remain migration-only and do not restore a second
  runtime.
- **Renderer/preload:** existing bridge methods remain; SSE acknowledgement and
  unrelated product methods are additive. The bridge remains `window.kunGui`.

## Final validation evidence

| Check | Final result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test` | 452/452 files, 3,640/3,640 tests pass |
| `npm --prefix kun run typecheck` | pass |
| `npm --prefix kun test` | 178/178 files, 1,499/1,499 tests pass |
| `npm run build` | pass; Kun, main, preload, and renderer production bundles built without the prior image-gen warning |
| Code/Design/Write/Connect focused smoke | 10/10 files, 89/89 tests pass; the complete Claw suite contributes 73 passing tests in the full root run |
| Real Electron-as-Node hybrid serve smoke | ready handshake; 200 health; 401/200 auth; 201 create/fork; 200 read/archive/search/workspace/SSE; SIGTERM exit 0; port released; SQLite/JSONL persisted; no WAL/SHM |

## Residual, non-blocking risks

- Several renderer files remain large (`settings-section-providers`,
  `PluginMarketplaceView`, message timeline bubbles, model picker, and Composer).
  Their pure rules and async lifecycles are covered, but future feature work should
  continue extracting named owners only when a real state or interaction boundary
  is stable; mechanical splitting would add navigation cost without reducing risk.
- No live paid-provider request was made during the local smoke because no external
  credentials were used. Provider compatibility is proven by deterministic wire
  transcripts rather than a production API call.
- No manual mouse/keyboard walkthrough of a packaged GUI was performed in this
  environment. Production bundling and focused Code/Design/Write/Connect component
  tests cover the available automated path; visual layout remains the principal
  manual-release check.

These are release-observation items, not known open correctness or lifecycle
defects in the remediated paths.
