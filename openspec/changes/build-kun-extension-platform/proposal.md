## Why

Kun already has isolated pieces of an extension ecosystem—declarative UI appearance packs, MCP servers, Skills, dynamic tools, and multi-provider model routing—but third parties cannot ship a cohesive application with workbench UI, background logic, Agent workflows, tools, accounts, and custom model transports. A versioned extension platform is needed now so these capabilities can be opened without creating a second Agent runtime or exposing unstable Kun and Electron internals as the de facto API.

## What Changes

- Add a `.kunx` extension package, manifest, registry, validation, side-loading, development-directory loading, and custom HTTPS index format.
- Add a headless-capable Extension Manager owned by `kun serve`, with one isolated Node child process per active extension, versioned IPC, lifecycle management, quotas, logs, and crash containment.
- Replace hard-coded workbench panel identifiers with a contribution registry covering controlled sidebars, panels, editor surfaces, commands, settings, menus, notifications, message actions, and composer actions.
- Add sandboxed extension Webviews plus explicitly high-risk isolated-world DOM content scripts; raw host DOM remains outside the compatibility contract.
- Expose a public Agent SDK for extension-owned runs, events, steering, cancellation, thread ownership, budgets, and stable Agent profiles.
- Let extensions register tools that are dispatched through Kun's existing ToolHost and approval model without allowing extensions to self-approve external effects.
- Add full extension-defined model Provider adapters, normalized streaming events, headless routing, model discovery, cancellation, usage, and explicit no-fallback failure behavior.
- Separate provider definitions, user accounts, and provider bindings; migrate stored API keys to account references backed by protected credential storage.
- Publish framework-neutral and React SDKs, test utilities, scaffolding, CLI commands, runnable examples, JSON Schema, and complete Chinese/English developer documentation.
- Keep the current appearance-pack UI plugins, MCP marketplace, and Skill system operational as separate product surfaces.
- Support the current and previous Extension API major versions; all published APIs are stable from release, while raw DOM selectors are explicitly unsupported.

## Capabilities

### New Capabilities

- `extension-package-management`: `.kunx` manifests, validation, installation, registry state, development loading, custom indexes, rollback, enablement, and removal.
- `extension-host-runtime`: headless Node extension processes, activation lifecycle, versioned IPC, resource limits, logging, crash isolation, and runtime diagnostics.
- `extension-workbench-contributions`: dynamic workbench contribution points, sandboxed Webviews, isolated-world DOM content scripts, commands, menus, settings, and protected consent surfaces.
- `extension-agent-tools`: extension-owned Agent runs and threads, event streaming, steering/cancellation, Agent profiles, tool registration, approval enforcement, and cache-stable tool discovery.
- `extension-model-providers`: complete extension-defined model transports, provider discovery, normalized model requests and streams, cancellation, usage, and failure semantics.
- `extension-accounts-secrets`: multiple accounts per provider, API key/OAuth/device authentication, account references, authenticated fetch, protected secret storage, and legacy-key migration.
- `extension-api-versioning`: manifest/API/RPC/state version negotiation, SemVer compatibility, deprecation, state migration, and current-plus-previous-major support.
- `extension-developer-ecosystem`: public SDK packages, React bindings, CLI and scaffolding, test harnesses, examples, schemas, bilingual documentation, and documentation validation.

### Modified Capabilities

- None.

## Impact

- Kun runtime: new extension composition services, child-process host bridge, routes, CLI commands, ToolHost provider, remote ModelClient adapter, account store, and persisted extension metadata.
- Electron: custom extension protocol, protected dialogs, guest Webview preload/guards, isolated-world content-script injection, IPC validation, and plugin file selection.
- Renderer: contribution registry, dynamic workbench layout, extension management views, extension Webview hosts, and provider/account selectors.
- Shared contracts: manifest, permissions, contributions, accounts, providers, Agent runs, extension events, errors, and compatibility schemas.
- Tooling and distribution: new npm workspace SDK packages, `.kunx` packing, examples, JSON Schema generation, bilingual documentation, CI validation, and packaged-app resources.
- Existing stored model credentials require a non-destructive migration to account references; existing appearance plugins, MCP configuration, Skills, threads, and Kun HTTP/SSE chat behavior remain compatible.
