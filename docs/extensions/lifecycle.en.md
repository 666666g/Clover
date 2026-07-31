# Activation and Lifecycle

> Extension API: v1
> 中文：[激活与生命周期](./lifecycle.md)
> Related: [Manifest activation events](./manifest.en.md#activation-events) · [State migration](./versioning-and-migrations.en.md#state-schema-migration)

The Kun `ExtensionManager` owns extension lifecycle. Installed or enabled does not mean executed: Kun discovers the Manifest statically and runs an entry only after compatibility, grants, and workspace policy pass and a declared activation event occurs.

## State flow

```text
installed
  -> compatible + enabled + permission admitted
  -> inactive
  -> activating (one joined attempt)
  -> active
  -> deactivating
  -> inactive / disabled / uninstalled

activating or active
  -> failed / crashed
  -> bounded restart backoff
  -> inactive or circuit-open
```

An incompatible package, integrity failure, failed state migration, or missing required capability stops admission before any Node, Webview, or content-script code executes.

## Static discovery

The workbench reads titles, icons, placement, and `when` conditions from the Manifest without activation. Therefore:

- do not perform installation, migration, or network requests at module top level;
- do not assume a visible icon means the Node Host has started;
- declare a matching activation event for each runtime capability;
- a browser-only View can establish a View Session without a Node Host;
- headless contributions require `main`.

## `activate(context)`

The Node entry exports:

```ts
import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', refresh),
    await context.tools.registerTool(lookupDefinition, lookupHandler)
  )
}

export async function deactivate(): Promise<void> {
  // Optional final cleanup. Do not start new work here.
}
```

`ExtensionContext` is the negotiated public capability set and includes:

- `commands` and `ui`;
- `storage`, `network`, and the `workspace` file service, plus read-only `workspaceContext`;
- `agent`, `threads`, and `tools`;
- `modelProviders` and `authentication`;
- `subscriptions: DisposableStore`.

The presence of a service does not guarantee that every call is granted. Each operation still checks connection-bound permission, workspace trust/scope, and current policy. If an optional minor capability is unavailable, the host returns a structured unsupported-capability result; degrade or stop that feature.

## Disposable rules

Every command, event listener, tool, Provider, timer, stream subscription, and View Session registration must be added with `context.subscriptions.add(...)` or explicitly disposed by the extension.

`DisposableStore` provides `add`, `clear`, `dispose`, and `isDisposed`. Disposal must be idempotent:

- accept no new calls after disposal;
- release host-side registrations and listeners;
- cancel or terminate in-flight work;
- ignore late results after a terminal fence;
- do not delete persisted thread/tool history.

Do not rely on a process `exit` handler as the only cleanup path; it may not run after timeout, crash, or forced termination.

## Serialized activation

One Kun runtime has at most one Node Host for one extension version. If multiple Views, commands, or tools trigger concurrently:

1. Kun joins them into one activation;
2. all callers await the same result;
3. `activate` runs once;
4. exceeding the startup limit fails the attempt with activation-timeout.

The default activation deadline is 15 seconds, but platform or user policy may tighten it. Do not block `activate` on long network, model, or user interaction. Register handlers, return promptly, and perform work when an operation is invoked.

## Deactivation triggers

An extension stops on:

- global/current-workspace disable;
- selected-version switch or rollback;
- uninstall;
- Kun runtime shutdown;
- permission/workspace changes that make contributions ineligible;
- circuit opening after repeated crashes;
- explicit developer reload.

Kun rejects new calls, propagates cancellation to active calls, invokes `deactivate()` once when possible, disposes registrations, waits for the shutdown deadline, and terminates the Host. Defaults are a 5-second shutdown deadline and 2-second cancellation grace, but host policy may tighten them.

## Cancellation and terminal outcomes

Long operations use a Host-assigned request ID. After cancellation:

- stop upstream network/model/tool work promptly;
- emit no further non-terminal stream events;
- produce at most one terminal outcome;
- release queue, acknowledgement/backpressure, and correlation state;
- do not commit late success as run/tool/Provider success.

If an external effect may have happened but cannot be confirmed, return an unknown outcome. Retry is possible only for a declared-idempotent operation that reuses a stable invocation key and passes Kun policy.

## View Session lifecycle

Each complex View instance receives an independent View Session. Multiple instances have different session nonces. Closing a View, changing workspace, disabling/uninstalling, or a guest crash:

- cancels pending bridge calls;
- disposes message/event subscriptions;
- releases host resources;
- rejects later stale-guest messages.

Closing a browser View normally does not stop a Node Host that still has background contributions. An extension with no background contribution may deactivate under the idle policy after its last View closes.

The current idle policy uses a 30-second grace period and counts all concurrent View Sessions per extension. A new Session synchronously retains the Host and cancels a pending timer before asynchronous activation; the timer starts only after the final Session is released. If teardown has already started, reopening waits for the old Host's registrations to finish cleanup before starting a fresh Host, so late cleanup cannot delete new registrations. Runtime shutdown, disablement, uninstall, and version switches clear pending timers.

Kun classifies background capability conservatively. View-idle deactivation is allowed only for an extension with `main`, activation events consisting entirely of `onView:*`, and no command, tool, model Provider, authentication, Agent profile, or `hostContentScripts` contribution. `onStartup` and every non-View activation event are background capability. Browser-only extensions have no Node Host and do not participate in this policy; Provider, tool, and other headless Hosts remain available without a GUI or View.

## Headless lifecycle

`kun serve` and `kun exec` use the same ExtensionManager. Without Electron:

- Node tools, Providers, Agent profiles, and background commands can activate;
- browser Views and content scripts are absent;
- connected accounts can be used or refreshed;
- login, consent, approval, or user input returns interaction-required or remains gated;
- Kun never auto-approves or fabricates user answers.

## Crashes and circuit breaking

A Host crash fails only that extension's in-flight operations. By default, three consecutive unhealthy starts/crashes open the circuit. Restarts use bounded backoff and never automatically replay a potentially side-effecting call. Recovery requires explicit retry, reload, version change, or re-enable.

Use:

```bash
kun extension doctor acme.issue-assistant
kun extension logs acme.issue-assistant
kun extension reload acme.issue-assistant
```

Diagnostics show activation cause, state, process, restart count, circuit, limit errors, and a redacted last error.

## State migration occurs before activation

When a newly selected version raises `stateSchemaVersion`, its Node `main` exports `migrateState(state, context)`. Kun backs up the complete committed state, then invokes that function separately for global and each workspace namespace; `context` contains the scope and from/to versions. The new version activates only after every result validates and commits transactionally with package selection. Failure retains the old package/state, and Kun never runs an upgrade migration in reverse. See [Versioning and migration](./versioning-and-migrations.en.md).

## Recommended practices

- Keep `activate` fast, deterministic, and diagnosable.
- Register static capabilities before starting cancellable background work.
- Manage every resource through `context.subscriptions`.
- Make repeated cancel/dispose idempotent.
- Do not read secrets or workspaces at module top level.
- Do not cache an account secret beyond the call lifetime.
- Honor stream backpressure; never create unbounded arrays or queues.
- Provide actionable handling for interaction-required, permission-revoked, and circuit-open results.
