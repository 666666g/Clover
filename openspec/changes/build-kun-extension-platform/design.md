## Context

Kun is an Electron + React desktop workbench whose only live Agent runtime is the bundled TypeScript `kun serve` process. Renderer features cross the constrained `window.kunGui` preload bridge into Electron Main, which owns process and system integration, while conversation state, tools, model routing, approvals, HTTP routes, and SSE events live in Kun. That boundary must remain intact.

The repository already contains four adjacent but separate extension mechanisms:

- a safe, declarative UI appearance-pack format under `~/.kun/ui-plugins`;
- a renderer marketplace for MCP servers and Skills;
- a dynamic Kun `CapabilityRegistry` that composes built-in, MCP, Skill, web, media, memory, and GUI tool providers;
- a `MultiProviderModelClient` and settings catalog that route a request to one of several compatible providers.

None of these is a general application-extension contract. The right workbench rail and panel renderer are hard coded, third parties have no supported background lifecycle, plugin-owned Agent API, account abstraction, custom model transport, version negotiation, package tooling, or comprehensive developer documentation.

The product decisions for this change are intentionally broad: v1 ships as one complete release; accepts unsigned local and custom-index packages; permits Node extensions and complete model adapters; supports headless use; exposes broad workbench contribution points; permits raw DOM content scripts as an explicitly unsupported surface; does not implement update checking; publishes every public API as stable; and keeps appearance packs, MCP, and Skills as separate systems.

## Goals / Non-Goals

**Goals:**

- Provide a cohesive, documented package and API through which third parties can build workbench applications, background services, Agent workflows, tools, authentication providers, and model providers.
- Preserve one Kun Agent runtime and make headless extension tools/providers work through `kun serve` and CLI without Electron.
- Isolate each Node extension for lifecycle and crash containment, while accurately disclosing that arbitrary Node code retains the current user's operating-system privileges.
- Give Webview and Web-extension content a narrow, sender-validated, capability-gated bridge instead of the full GUI preload API.
- Keep Agent approvals, thread ownership, tool catalog stability, cache behavior, model usage, and provider failure semantics under Kun control.
- Establish a stable, version-negotiated Extension API with current-plus-previous-major compatibility, atomic state migrations, SDKs, examples, schemas, testing tools, and bilingual documentation.
- Protect installation consent, credentials, and other privileged user decisions from extension Webviews and DOM content scripts.

**Non-Goals:**

- Replacing or merging the existing appearance-pack, MCP, or Skill formats.
- Adding a second Agent runtime, exposing `AgentLoop`, or letting an extension connect to the runtime with the GUI bearer token.
- Providing an operating-system security sandbox for Node extensions.
- Supporting silent, scheduled, or automatic extension updates in v1.
- Guaranteeing compatibility for raw Kun DOM selectors, CSS classes, React component structure, or internal HTTP/RPC details.
- Allowing third-party React components to execute inside the Kun React tree.

## Decisions

### 1. Kun owns extension composition; each active Node extension gets its own host process

`kun serve` gains an `ExtensionManager` at its runtime composition root. It discovers installed manifests, resolves enablement and compatibility, starts a child host only on an activation event, and exposes sanitized registry and lifecycle operations through versioned `/v1/extensions/*` routes. `kun exec` uses the same service so headless tools and providers behave consistently.

Every extension with a `main` entry runs in a separate Node child process using the bundled host runner and Node IPC. The parent assigns extension identity, version, granted broker permissions, roots, account handles, and a random lifecycle nonce; those fields are never trusted from the child. JSON-only envelopes carry request/response, notification, stream sequence/ack, cancellation, and structured error messages. Stdout/stderr remain plugin logs rather than protocol channels.

Per-extension processes cost more memory than one shared host, but prevent one extension from importing or corrupting another extension's in-process globals and allow targeted termination and crash reporting. A shared Node host was rejected because arbitrary side-loaded code could interfere with every other extension. Loading code inside `kun serve` was rejected because a plugin crash or dependency conflict could corrupt the Agent runtime.

The manager enforces activation timeout, maximum in-flight broker requests, message/stream limits, bounded logs, an extension-configurable but platform-capped memory limit, cancellation, graceful deactivation, restart backoff, and a crash circuit breaker. These controls are reliability limits, not a security sandbox.

### 2. `.kunx` is immutable, atomically installed, and indexed without automatic updates

A `.kunx` is a ZIP containing `kun-extension.json`, files declared by the manifest, an integrity file, and optional signature metadata. The public identifier is `publisher.name`; a version directory is immutable after validation. The registry selects one active version and stores global/workspace enablement separately from package content.

Installation extracts to a staging directory after validating archive and uncompressed limits, canonical relative paths, duplicate/case-colliding names, symlinks, manifest schema, declared entries, integrity hashes, engine/API compatibility, and optional signatures. Success atomically moves staging into `~/.kun/extensions/<id>/<version>` and changes the active pointer; failure leaves the current version untouched. The immediately previous version remains available for explicit rollback.

Sources are local `.kunx`, a development directory, or an HTTPS extension index. An index contains a schema version, package metadata, exact versions, engine range, URL, SHA-256, permissions summary, and optional signature. Kun downloads only after an explicit install action and verifies the selected version. It does not poll, compare, notify, or auto-install newer versions.

Existing UI appearance packs, MCP config, and Skills retain their directories and management flows. The extension center may link to those surfaces but does not adapt or migrate their records.

### 3. Permission enforcement is capability-based for brokers and disclosure-based for raw Node access

The manifest declares permissions for Agent runs, threads, tools, workspace operations, network domains, accounts, secret reveal, shell, storage, notifications, UI slots, Webviews, content scripts, and provider registration. The registry records the permission snapshot accepted for a particular extension version and workspace.

Every SDK/Broker operation checks the bound extension identity, permission, workspace scope, resource scope, input schema, request limit, and lifecycle state. Webview requests also validate the guest sender and view session. Extensions cannot grant themselves permissions or use one extension's account, storage, thread, or view session.

Node code can bypass the broker with built-in Node filesystem/network/process APIs. The install UI and documentation therefore state that Node and DOM permissions are disclosure and audit for those direct operations, not an OS sandbox. Hiding this limitation was rejected as misleading; cross-platform AppContainer/bubblewrap/macOS sandboxing is outside v1.

Installation permission consent, secret entry, account authorization completion, and plugin-originated privileged confirmation run in protected Main-owned surfaces where no extension Webview or content script is attached. Privileged IPC requires a short-lived Main-issued consent token bound to the action, sender, extension, and expiry; a synthetic DOM click alone cannot authorize it.

### 4. Workbench contributions use stable slots; complex views use sandboxed guest content

Built-in and extension workbench items share a `ContributionRegistry`. Stable identifiers use `builtin:<id>` and `extension:<extensionId>/<contributionId>`. The registry accepts declarative contributions for activity containers, left/right views, editor panels/tabs, top-bar and composer actions, message actions/previews, commands, settings, context menus, and notifications. Context keys and a restricted `when` expression determine visibility without executing extension code during render.

Small controls are rendered by Kun using declared labels, icons, commands, and settings schemas. Custom applications are loaded from `kun-extension://<extensionId>/<path>` in a separate Webview partition with Node disabled, context isolation and Chromium sandbox enabled, restrictive CSP, denied permission requests, validated navigation, no popups, and a single bundled preload. Webview resources are confined to declared roots. Network is denied by default and normally uses `kun.net.fetch` so domains, accounts, quotas, cancellation, and auditing remain enforceable.

The guest preload exposes only a version-negotiated message/state/theme/command surface. Electron Main maps the WebContents to an extension/view session and forwards requests to Kun's Extension Broker; caller-supplied extension IDs are ignored. Extension events return over a reconnectable extension event stream and are routed only to the owning guest.

Raw DOM content scripts are a separate high-risk contribution. Electron executes them in a unique isolated world with an extension-scoped API and CSP. They share DOM access but not the page JavaScript global or `window.kunGui`. Matches are limited to declared, non-protected application routes. The manifest, installer, validator, logs, and docs label this surface unsupported: selectors and page structure may change in any Kun release and are not covered by API compatibility.

Direct main-world scripts and third-party React components were rejected because they would inherit the GUI bridge, couple to internal dependencies, and make version isolation impossible.

### 5. Extensions call Kun through owned Agent runs; Kun calls extensions through a tool provider

The public Agent service exposes creation, lookup, subscription, steering, cancellation, and listing of extension-owned runs/threads. Main/Kun derives `ownerExtensionId` from the host session. A run snapshots extension version, Agent profile, workspace, model/provider/account, token/time budgets, tool-provider allowlist, and tool catalog fingerprint into thread metadata.

Agent profiles may append dynamic instructions and choose an allowed tool/provider scope, but cannot replace the immutable Kun system prefix or bypass normal sandbox/approval policy. Extensions only see their own threads by default. More privileged read access is an explicit permission and still excludes secrets and protected internal metadata.

Extension tools register through the host, are namespaced by extension, and appear as an `ExtensionToolProvider` in the existing `CapabilityRegistry`. Tool calls carry the normal Kun context, abort lifecycle, explicit side-effect approval, output caps, operation identity, and structured updates. An extension cannot approve its own tool or settle a protected user-input gate.

To protect prompt caching and model context, a thread retains a stable catalog epoch. New/removed/changed extension schemas affect new threads or an explicit new epoch rather than silently mutating an in-flight thread. Large catalogs use a stable search/call facade analogous to progressive MCP discovery instead of advertising every schema on every model request.

### 6. Custom model adapters implement a normalized public stream, not Kun internals

Extensions register provider definitions and an adapter with `probe`, `listModels`, `stream`, `cancel`, and optional `countTokens`. `RemoteModelClient` implements Kun's internal `ModelClient`, translates an internal request into a public, provider-neutral message/content/tool/generation request, assigns a request ID, and routes it to the owning host. The host returns versioned text, reasoning, tool-call, usage, terminal, and error events with sequence numbers and backpressure.

The public request contains the full model-visible conversation, attachments, tools, model choice, reasoning and sampling controls, and an account reference. It never exposes internal stores, `TurnItem` object identity, runtime auth, or live `AbortSignal`. Cancellation is a separate message. Invalid ordering, malformed events, missing terminal usage, idle streams, host crashes, or disabled adapters become explicit provider errors.

An explicitly selected unknown/unavailable extension provider never falls back to another provider. This preserves the existing multi-provider invariant that private content is not silently sent through different credentials. Provider installation and first selection disclose that the extension receives complete model inputs.

### 7. Provider definitions, accounts, and bindings are separate persisted concepts

A provider definition describes identity, transport, models/capabilities, default endpoints, and an authentication-provider reference. An account is a user-owned credential instance with label, provider, authentication kind, non-secret metadata, status, and a protected secret reference. A provider binding selects a provider, account, and model for a runtime/thread/role.

API keys, OAuth refresh/access tokens, device-code results, and custom secrets are stored through an account credential store. The preferred backend is the platform credential facility; the existing Kun encrypted secret store is the documented fallback. Settings, threads, extension state, and renderer payloads contain account references and redacted metadata, not secret material.

The broker offers account listing, session creation/deletion, authorization, authenticated fetch, refresh, and status. Authenticated fetch injects credentials without revealing them. A Node adapter that must implement custom request signing may request the separately disclosed `accounts.secrets.read` permission and read the selected secret; this cannot be made safe from arbitrary Node code and is logged.

On first load, existing model-provider API keys are imported into accounts and provider/runtime selections receive bindings. Migration is idempotent, retains a pre-migration backup, continues to read legacy fields for one compatibility cycle, and writes only account references after a successful save. Missing extension provider definitions keep their account and binding records as unavailable rather than deleting credentials.

### 8. Public and internal versions negotiate independently

The package version, `manifestVersion`, Extension `apiVersion`, internal `rpcVersion`, `stateSchemaVersion`, and `engines.kun` range are independent. Public API minor versions add optional fields/methods only; removals or semantic breaks require a new major. Kun supports the current and immediately previous API major: when v2 is current, v1 and v2 run; v1 can be removed only when v3 ships.

Host activation negotiates an exact supported API and RPC adapter before evaluating extension code. Unsupported packages remain installed but disabled with a structured diagnostic. Deprecation metadata and runtime warnings name the replacement and removal major. All public v1 APIs are stable; there is no experimental namespace.

Extension state is namespaced by extension and scope. An update that changes `stateSchemaVersion` runs the extension's migration against a copy, atomically commits on success, and retains the old version/state for rollback on failure. Automatic reverse migrations are forbidden. Raw DOM/CSS/internal route behavior is explicitly outside these guarantees.

### 9. The SDK, tooling, examples, and bilingual docs are release-blocking artifacts

The repository becomes an npm workspace for framework-neutral `@kun/extension-api`, `@kun/extension-react`, `@kun/extension-test`, and `create-kun-extension` packages. The public API package owns canonical TypeScript/Zod schemas and produces the manifest JSON Schema. The React package is optional and uses only the framework-neutral bridge. The test package supplies fake host/Agent/tool/provider/account/Webview services.

`kun extension` commands create, validate, pack, install, list, enable, disable, uninstall, diagnose, and display logs. Development directories are explicit and reload only on a developer action. Examples cover a sidebar, workspace dashboard, Agent assistant, tool, streaming provider with authentication, and isolated-world content script.

Chinese source documentation and corresponding `.en.md` files cover architecture, quick start, manifest, lifecycle, UI contributions, Webviews, DOM risks, Agent API, tools, providers/accounts, permissions/security, storage/network/logging/quotas, packaging/indexes, versioning/migrations, CLI/testing/debugging, compatibility, release checklist, and changelog. CI validates schema examples, snippets, links, bilingual pairs, example typechecks, package validation, and smoke runs.

Generated API reference alone was rejected because it cannot explain lifecycle, security, UX, compatibility, and provider data-disclosure rules. Handwritten reference alone was rejected because it can drift from executable schemas.

## Risks / Trade-offs

- [Unsigned Node extensions can execute arbitrary user-level code] → Require explicit high-risk disclosure, isolate processes for reliability, keep secrets out of default contexts, log broker operations, and never claim the permission list is an OS sandbox.
- [DOM content scripts can spoof or disrupt the workbench] → Run in isolated worlds, exclude protected surfaces, require consent tokens for privileged actions, label the API unsupported, and provide stable slots/Webviews as the documented path.
- [A single complete release creates a large integration surface] → Implement behind an internal build-time gate, land contracts and characterization tests first, keep existing systems intact, and remove the gate only after every acceptance suite and packaged-app smoke test passes.
- [Per-extension child processes consume memory] → Activate lazily, enforce an idle policy and memory cap, and deactivate extensions without background contributions when their last view closes.
- [Custom providers can leak full prompts or emit malformed streams] → Disclose data access, validate every event, enforce timeouts/backpressure/cancellation, and fail explicitly without provider fallback.
- [Tool plugins increase prompt size and cache churn] → Namespace tools, freeze per-thread catalog epochs, canonicalize schemas, and use progressive search/call facades for large catalogs.
- [Credential migration could lock users out] → Back up, make migration idempotent, retain legacy reads for one cycle, verify imported account usability, and preserve unavailable bindings/secrets.
- [Supporting two API majors increases maintenance] → Isolate public protocol adapters, keep internal RPC independent, run both-major conformance fixtures in CI, and remove only at the documented major boundary.
- [Custom HTTPS indexes can be compromised] → Require HTTPS, explicit install, exact SHA-256, immutable versions, source display, and no update polling or silent replacement.
- [Extension Webviews expand Electron attack surface] → Upgrade to a supported Electron release before shipping, keep Node disabled and sandboxing enabled, validate every guest attachment/navigation/sender, deny browser permissions, and follow Electron's security checklist.

## Migration Plan

1. Add canonical extension/API/account contracts, schemas, conformance fixtures, package directories, and an internal platform gate without exposing UI.
2. Implement package registry/installer/index and per-extension host lifecycle with headless CLI coverage.
3. Add Agent/tool and provider/account bridges, migrate credentials transactionally, and verify existing chat/provider behavior with the gate still internal.
4. Add Electron protocol/Webview/content-script security, protected consent surfaces, renderer contribution registry, and extension management UI.
5. Publish SDK/tooling packages, runnable examples, JSON Schema, and complete Chinese/English documentation.
6. Run current/previous-major conformance, security, migration, headless, desktop E2E, build, and packaging validation. Remove the internal gate and expose the platform only when all release criteria pass.

Rollback keeps the old application version, legacy settings backup, and previous active extension version. New extension/account records are additive; if the application rolls back, legacy provider fields from the compatibility backup remain available. No partial v1 platform is intentionally exposed to ordinary users.

## Open Questions

None. Product scope, trust model, distribution behavior, compatibility policy, UI/DOM model, provider scope, headless behavior, SDK strategy, documentation languages, legacy-system separation, and single-release delivery are locked by the confirmed plan.
