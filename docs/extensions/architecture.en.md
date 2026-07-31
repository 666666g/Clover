# Architecture and Boundaries

> Extension API: v1
> 中文：[架构与边界](./architecture.md)
> Next: [Quick start](./quick-start.en.md) · [Permissions and trust](./security-and-resources.en.md)

## Core invariant

The Kun extension platform does not create a second Agent runtime. Agent conversations, threads, tools, approvals, events, Provider routing, and usage remain owned by the single `kun serve` process. Extensions reach them only through the public Host Context and capability brokers.

```text
Renderer / Workbench
  | host-rendered contributions
  | sandboxed extension Webviews
  v
Electron Main
  | sender validation / protected consent / kun-extension://
  | existing preload -> runtime boundary
  v
kun serve
  ExtensionManager
    | one child process per active Node extension
    | versioned private JSON IPC
    v
  Extension Host processes
    | public Host Context / SDK only
    v
  AgentLoop / ToolHost / EventBus / stores / ModelClient routing
```

`rpcVersion` belongs only to Kun and the bundled Host runner and is private. Extensions must not speak it directly or receive the GUI/runtime bearer token.

## Execution locations

| Extension content | Executes in | Best for | Security/compatibility note |
| --- | --- | --- | --- |
| `main` | Dedicated Node child process per extension | Tools, Providers, authentication handlers, Agent work, background commands | Has current-user OS privileges; process isolation is not a security sandbox |
| `browser` / View | Host-created isolated Chromium Webview | Complex sidebar, editor, or panel UI | Node is off; bridge is narrow; direct network is blocked by default |
| Declarative contribution | Host component in the Kun React tree | Command actions, menus, settings, notifications | No extension React executes there; host owns accessibility and UX |
| `hostContentScripts` | Extension-specific Electron isolated world | Rare cases that must read or change host DOM | High risk; DOM/selectors are unstable; excluded from protected windows |

A browser-only extension does not start a Node process. Any headless tool, Agent profile, model Provider, authentication handler, scheduled work, or background command requires `main`; `browser` is never a headless fallback.

## ExtensionManager and Host

`ExtensionManager` lives at the Kun runtime composition root and is shared by `kun serve`, `kun exec`, and GUI requests. It:

- reads installed versions, selected version, global/workspace enablement, and permission snapshots;
- lazily starts a Node Host after an activation event;
- binds extension identity, version, workspace, grants, and lifecycle nonce to the parent-child connection;
- bounds activation/operation time, concurrency, queues, messages, event rates, stream buffers, and memory;
- propagates cancellation, waits for deactivation, disposes registrations, and prevents orphan processes;
- applies bounded restart backoff and a per-extension circuit breaker;
- exposes extension-scoped status, rotating logs, and redacted diagnostics.

Within one Kun runtime, an extension version has at most one Node Host. Different extensions never share a Node process. Concurrent activation requests join one attempt.

## Identity, permissions, and brokers

Identity comes from the host connection or the WebContents/View Session, never from an `extensionId` supplied in a payload. Every broker operation checks again:

1. whether the extension/version is enabled, compatible, and not circuit-open;
2. workspace trust, scope, and permission grants;
3. resource ownership for threads, accounts, state, or View Sessions;
4. schema, size, rate, concurrency, and quota limits;
5. whether protected user consent or the Kun ApprovalGate is required.

Node code can bypass a broker by using Node filesystem, network, or process APIs directly. Manifest permissions are enforced for broker operations; for direct Node OS access they are disclosure and audit only. See [Permissions and trust](./security-and-resources.en.md).

## UI data path

Declarative contributions are discovered statically from the Manifest without activating code. The owning extension activates when the user actually opens a View or invokes a command.

```text
Manifest metadata -> ContributionRegistry -> host-rendered icon/action
user opens view -> protected session creation -> Webview preload bridge
guest request -> Electron sender/session validation -> Kun Broker -> Node Host
extension event -> bounded/replayable event channel -> owning View Session only
```

A View Session binds extension ID, version, contribution ID, workspace, WebContents, and an unguessable nonce. Caller-supplied identity or session fields cannot change the binding. Webview resources load only through `kun-extension://<extension-id>/...` from declared resource roots in the selected installed version.

## Agent, tool, and Provider data paths

When an extension calls the Agent, Kun creates or resumes a durable extension-owned thread and records owner, creating version, profile, Provider/account, budget, and tool catalog epoch. Events come from Kun's persisted event source and can replay from a sequence cursor.

When Kun calls an extension tool, the model tool call still traverses `CapabilityRegistry -> ToolHost -> ExtensionToolProvider`. Kun controls arguments, approval, authorization, cancellation, output limits, and history order. The tool catalog is pinned at a thread/epoch boundary so extension activation and registration order do not churn the model prefix.

An extension Provider receives a normalized request through `RemoteModelClient` and its Node Host. It emits ordered text, reasoning, tool-call, usage, and terminal events. An unavailable selected Provider fails explicitly; Kun never silently changes Provider, account, or same-named model.

## Headless behavior

Closing the GUI does not change Node tool or Provider registration or semantics. With the same Kun data directory, the GUI, `kun serve`, and `kun exec` observe the same selected versions, enablement, grants, circuit state, extension state, and account bindings.

If login, renewed consent, approval, or user input is needed, headless paths return a structured `interaction-required` or gated result. They do not implicitly open a GUI and never auto-approve because a GUI is absent.

## Persistence boundaries

- Immutable packages: `~/.kun/extensions/<publisher.name>/<version>/`.
- Registry: installed versions, active selection, source, digest, signature status, permission snapshots, and enablement.
- Extension data: identity-isolated global/workspace scopes outside package directories.
- Host health: `~/.kun/extension-data/host-health.json` stores non-secret per-extension restart/circuit health.
- Account secrets: an OS credential facility, or an authenticated encrypted fallback; ordinary settings contain only account/credential references.
- Logs: separated by extension and process instance, rotated, bounded, and redacted.

Uninstalling package code does not delete state, logs, or account references by default. Data removal is a separate explicitly confirmed operation.

## Failure boundaries

An activation error, protocol violation, limit breach, or crash in one extension fails only that extension's calls. Messages after cancellation or a terminal fence are discarded. If a tool may have caused an external effect but its Host crashes before confirming the outcome, Kun reports an unknown outcome and does not retry automatically unless the tool is declared idempotent and policy permits reuse of a stable invocation key.

## Public and private interfaces

Extensions may depend only on official SDKs, schemas, CLI behavior, public diagnostics, contribution points, and documentation. The following are private implementation details:

- Electron IPC channels and WebPreferences details;
- `window.kunGui` and renderer stores/React modules;
- the Kun HTTP bearer token and internal `/v1/*` route shapes;
- Node Host JSON IPC and the `rpcVersion` wire format;
- internal classes such as `AgentLoop`, `ModelClient`, and `ToolHost`;
- host DOM, CSS, and React structure.

These internals may change as long as documented behavior remains compatible for supported API majors.
