## Why

Kun's largest remaining modules combine lifecycle state machines, protocol families,
persistence recovery, event projection, and complex UI interaction in a handful of
files. Their broad blast radius makes otherwise local changes difficult to review,
test, and roll back, so the next health pass must establish narrow owners without
changing product behavior.

## What Changes

- Separate Electron runtime supervision, Kun process control, health monitoring,
  configuration application, and shutdown coordination.
- Separate compatible model request/stream handling by endpoint family while
  retaining one public model client and identical wire behavior.
- Split Claw/IM conversation coordination from Feishu, Telegram, and Weixin channel
  adapters and from attachment/reply delivery.
- Convert renderer runtime event handling into deterministic normalization,
  projection, and explicit side-effect boundaries.
- Separate workflow graph planning, scheduling, run coordination, and node executors,
  and split node-specific configuration panels.
- Separate hybrid thread index, document recovery, projection, and backfill concerns
  without migrating persisted data.
- Decompose Composer and Sidebar UI state into focused hooks/components with stable
  interaction and accessibility behavior.
- Establish a single settings-domain contract used by defaults, normalization,
  migration, IPC validation, provider presets, and settings UI.
- Preserve the public HTTP/SSE surface, settings and session formats, provider request
  bodies, tool schemas, cache-prefix behavior, and renderer-visible event order.

## Capabilities

### New Capabilities

- `runtime-supervision-boundaries`: Electron runtime startup, restart, health,
  configuration, and shutdown ownership and concurrency invariants.
- `model-protocol-boundaries`: Endpoint-family request builders, stream decoders,
  tool-call aggregation, usage normalization, and public client compatibility.
- `im-runtime-boundaries`: Common IM conversation/reply coordination and isolated
  Feishu, Telegram, and Weixin channel behavior.
- `renderer-event-projection`: Deterministic Kun event normalization, chat projection,
  reconciliation, and explicit renderer effects.
- `workflow-execution-boundaries`: Workflow planning, scheduling, execution, node
  adapters, cancellation, approvals, and node-specific configuration UI.
- `hybrid-thread-persistence-boundaries`: Thread index/document ownership, legacy
  recovery, backfill, merge rules, and persisted-format compatibility.
- `workbench-ui-composition`: Focused Composer and Sidebar interaction owners with
  stable keyboard, attachment, model, project, preview, and worktree behavior.
- `settings-domain-contract`: Canonical settings defaults, normalization, migration,
  validation, provider capability metadata, and UI patch behavior.

### Modified Capabilities

None. This is an internal health and stability change; product requirements and
public contracts remain unchanged.

## Impact

- Electron main process: `src/main/index.ts`, `src/main/kun-process.ts`, Claw,
  Workflow, scheduler, and IPC composition.
- Kun runtime: compatible model adapters, runtime factory, hybrid stores, ports, and
  focused characterization tests.
- Renderer: Kun event mapper/store, Composer, model controls, Sidebar, Workflow
  configuration, and Settings sections.
- Shared contracts: settings types/defaults/normalizers and IPC schemas.
- No new runtime, provider selector, protocol endpoint, persisted-data migration, or
  user-facing feature is introduced.
