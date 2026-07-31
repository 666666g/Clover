## ADDED Requirements

### Requirement: Kun publishes a stable framework-neutral Extension API
Kun SHALL provide a versioned `@kun/extension-api` package containing the public manifest, lifecycle, disposable, command, contribution, Agent, tool, provider, authentication, storage, network, and UI-message contracts. The package MUST remain usable without React or Electron imports and MUST expose only documented stable APIs rather than Kun runtime internals.

#### Scenario: Framework-neutral extension compiles
- **WHEN** a developer builds a TypeScript extension against only documented exports from `@kun/extension-api`
- **THEN** the extension type-checks and can activate in a compatible Extension Host without importing Kun source files

#### Scenario: Extension imports an internal path
- **WHEN** an extension imports a Kun internal module or an undeclared SDK subpath
- **THEN** validation or module loading rejects the unsupported dependency with guidance to the public API

#### Scenario: Extension deactivates
- **WHEN** Kun deactivates an extension that registered public resources
- **THEN** the SDK disposes its registered commands, events, providers, tools, timers, and sessions through the documented `Disposable` lifecycle

### Requirement: Kun provides an official React Webview kit
Kun SHALL provide `@kun/extension-react` as an optional package layered on the framework-neutral API. The React kit MUST include typed hooks and components for host messaging, theme and localization changes, durable View state, command invocation, Agent streams, cancellation, loading, errors, and disposal without granting direct access to `window.kunGui` or Electron APIs.

#### Scenario: React sidebar follows the host
- **WHEN** a React Webview uses the official theme, localization, and state hooks and the Kun host changes theme or restores the View
- **THEN** the Webview updates through the supported message contract and restores only its extension-scoped state

#### Scenario: React View subscribes to an Agent run
- **WHEN** a component subscribes to an extension-owned run and then unmounts
- **THEN** the kit delivers typed stream state while mounted and disposes its View subscription when unmounted

#### Scenario: Non-React extension is built
- **WHEN** a developer chooses another UI framework or no framework
- **THEN** the extension can use the complete framework-neutral Webview messaging API without depending on the React package

### Requirement: Kun provides deterministic extension test utilities
Kun SHALL provide `@kun/extension-test` with deterministic fakes and harnesses for activation, permissions, commands, storage, Webview messaging, Agent events, tool calls, provider streams, account metadata, cancellation, time, and host failures. Test utilities MUST avoid real credentials, real model calls, and a running Electron application by default.

#### Scenario: Provider adapter is unit tested
- **WHEN** a developer supplies a scripted normalized provider stream to the test host
- **THEN** the harness can assert request translation, event order, usage, cancellation, and terminal behavior deterministically

#### Scenario: Permission is denied in a test
- **WHEN** a test configures a denied account, network, workspace, or Agent permission
- **THEN** the fake host returns the same public error shape promised by the production SDK

#### Scenario: Webview contract is tested headlessly
- **WHEN** a developer mounts a Webview against the message harness
- **THEN** the test can simulate host messages, state restoration, disposal, and malformed-message rejection without exposing Kun's renderer bridge

### Requirement: One schema source governs manifests and public wire contracts
Kun SHALL define each public manifest and extension wire contract from one versioned TypeScript/runtime-validation source and SHALL generate a distributable JSON Schema from that source. CLI validation, package installation, Extension Host parsing, SDK types, examples, editor completion, and documentation examples MUST use the same schema version and validation rules.

#### Scenario: Manifest is validated in different tools
- **WHEN** the same manifest is checked by the editor schema, `kun extension validate`, package installation, and runtime activation
- **THEN** every surface accepts or rejects it consistently and reports the same field paths and stable error categories

#### Scenario: Schema artifact drifts
- **WHEN** generated JSON Schema or checked-in API examples no longer match the runtime source schema
- **THEN** CI fails before release and identifies the stale generated artifact

#### Scenario: Public wire payload is malformed
- **WHEN** an example or test sends a provider, Agent, tool, account, or Webview payload that violates its public schema
- **THEN** the corresponding test or validator rejects it before the payload reaches extension business logic

### Requirement: The CLI covers the complete local extension workflow
The `kun extension` CLI SHALL provide `create`, `validate`, `pack`, `install`, `list`, `enable`, `disable`, `uninstall`, `doctor`, and `logs` commands. It MUST support explicit development-directory loading and reload, structured machine-readable output, actionable diagnostics, and operation without the desktop GUI for commands that do not require protected user interaction.

#### Scenario: Developer creates and packs an extension
- **WHEN** a developer runs `kun extension create`, builds the generated project, then runs `validate` and `pack`
- **THEN** the CLI produces a schema-valid `.kunx` package with deterministic contents and reports its ID, version, hash, and output path

#### Scenario: Developer loads a directory
- **WHEN** a developer explicitly installs or loads a local development directory and requests reload after rebuilding
- **THEN** Kun validates the current directory, activates it as a development source, and replaces its active host without converting it into an installed release package

#### Scenario: Doctor finds an incompatible extension
- **WHEN** `kun extension doctor` inspects an extension whose manifest, API, engine, entry point, permissions, or stored state is incompatible
- **THEN** it returns a non-zero result with stable diagnostic codes and concrete remediation while redacting secrets

#### Scenario: CLI output is automated
- **WHEN** a caller requests machine-readable output from a supported extension command
- **THEN** the CLI emits versioned structured data on standard output and sends human diagnostics to the documented diagnostic channel

### Requirement: Scaffolding supports the documented extension shapes
Kun SHALL publish `create-kun-extension` templates for a Node/TypeScript extension, a React Webview extension, and a framework-neutral Webview extension. Every template MUST include a valid manifest, build and test configuration, activation and disposal code, least-privilege permissions, packaging scripts, and links to the matching version of the developer documentation.

#### Scenario: TypeScript template is generated
- **WHEN** a developer selects the Node/TypeScript template and supplies a valid publisher and extension name
- **THEN** scaffolding creates a project that installs, type-checks, tests, validates, and packs without manual configuration

#### Scenario: React template is generated
- **WHEN** a developer selects the React Webview template
- **THEN** scaffolding creates separate host and Webview entry points with the official React kit and a sandbox-compatible asset build

#### Scenario: Invalid extension identity is supplied
- **WHEN** scaffolding receives an invalid or reserved publisher, name, or extension ID
- **THEN** it stops before writing a partial project and reports the manifest identity rules

### Requirement: Runnable examples cover every high-value extension path
The repository SHALL include runnable, least-privilege examples for a sidebar View, workspace dashboard, extension-owned Agent assistant, registered tool provider, custom streaming model provider with API-key and OAuth account use, and isolated-world DOM content script. Each example MUST use only public SDKs and documented host contracts.

#### Scenario: Examples are validated
- **WHEN** CI builds the extension examples
- **THEN** every example installs dependencies, type-checks, runs its tests, validates its manifest, packs successfully, and passes a targeted smoke test

#### Scenario: Streaming provider example runs headlessly
- **WHEN** the model-provider example is exercised without Electron
- **THEN** its fake provider can list models, accept a normalized request, stream text and usage, handle cancellation, and demonstrate explicit no-fallback failure

#### Scenario: DOM example is inspected
- **WHEN** a developer opens the direct-DOM example and its documentation
- **THEN** the example declares the elevated permission, uses an isolated world, avoids protected surfaces, and labels host selectors as unsupported compatibility dependencies

### Requirement: Developer documentation is complete and bilingual
Kun SHALL publish a Chinese normative documentation set and a corresponding English `.en.md` version for every extension developer guide. The set MUST cover overview and architecture, quick start, manifest reference, activation and lifecycle, contribution points and Webviews, direct-DOM risks, Agent and thread APIs, tool providers, model providers, accounts and authentication, permissions and trust, storage and network access, quotas and logs, packaging and custom indexes, versioning and state migration, CLI and debugging, testing, troubleshooting, release checklist, API reference, compatibility matrix, and changelog.

#### Scenario: New developer follows the quick start
- **WHEN** a developer with no Kun source-code knowledge follows either language's quick start
- **THEN** they can scaffold, run, test, validate, pack, install, and inspect a minimal sidebar extension using only published SDKs and documentation

#### Scenario: Developer implements a custom provider
- **WHEN** a developer follows the provider and account guides
- **THEN** they can implement model discovery, normalized streaming, cancellation, usage, headless activation, API-key or OAuth accounts, and required data disclosures without reading Kun internals

#### Scenario: Documentation describes unstable surfaces
- **WHEN** a guide mentions direct DOM, host CSS, or any non-SDK integration point
- **THEN** both language versions clearly mark it outside the stable compatibility contract and provide the supported alternative where one exists

### Requirement: Documentation distinguishes adjacent extension systems
Kun SHALL link the extension developer portal from the main README and SHALL explain how full extensions differ from existing appearance packs, MCP servers, and Skills. Existing documentation for those systems MUST remain available and MUST not imply that they have been migrated into the Extension API.

#### Scenario: User chooses an integration mechanism
- **WHEN** a user reads the extension overview from the main README
- **THEN** they can determine whether their use case requires a full extension, appearance pack, MCP tool server, or Skill and can navigate to the corresponding guide

#### Scenario: Existing appearance documentation is visited
- **WHEN** a user opens the appearance-pack documentation after the extension platform release
- **THEN** it still describes the non-executable appearance format and links to full extensions only for executable or workbench-integrated use cases

### Requirement: Documentation and SDK artifacts are version-aligned
Every published SDK, schema, CLI, template, example, API reference, compatibility matrix, and changelog SHALL identify the Extension API and Kun versions it documents. Versioned documentation MUST remain accessible for every supported Extension API major, and code samples MUST import versions compatible with the page that contains them.

#### Scenario: Current and previous API majors are supported
- **WHEN** Kun supports the current and previous Extension API major versions
- **THEN** the developer portal exposes reference documentation, migration guidance, and compatible SDK coordinates for both majors

#### Scenario: API is deprecated
- **WHEN** a public API is marked deprecated
- **THEN** the API reference, type declarations, validator diagnostics, changelog, and migration guide name its supported replacement and removal horizon

#### Scenario: Documentation version and sample differ
- **WHEN** a page, schema, or sample imports an SDK or uses a manifest version outside the page's declared compatibility range
- **THEN** documentation validation fails before publication

### Requirement: CI enforces ecosystem quality across supported platforms
CI SHALL validate public SDK builds, exported type surfaces, generated schemas, scaffolding templates, CLI behavior, all examples, documentation links and anchors, code snippets, bilingual structure, secret redaction fixtures, and package smoke tests. Release gates MUST exercise supported macOS, Windows, and Linux environments and MUST fail on undocumented public API exports or stale generated artifacts.

#### Scenario: Public API changes without documentation
- **WHEN** an SDK export, schema, CLI command, or stable diagnostic changes without the matching API reference and changelog update
- **THEN** CI fails and identifies the unmatched public surface

#### Scenario: Chinese and English guides drift structurally
- **WHEN** a normative guide adds, removes, or renames required sections or executable snippets without the corresponding English update
- **THEN** documentation CI fails with the unmatched files, headings, anchors, or snippets

#### Scenario: Cross-platform package smoke test runs
- **WHEN** release CI builds the SDKs and representative `.kunx` examples on macOS, Windows, and Linux
- **THEN** each platform validates, packs, installs into an isolated profile, activates the sample, and removes it without relying on repository-local paths

### Requirement: Public diagnostics are actionable and safe to share
SDK, CLI, schema, example, and documentation tooling SHALL use stable diagnostic codes, identify the failing extension and field or operation, and provide a documented remediation. Diagnostic output MUST be safe to attach to bug reports by default and MUST redact secrets, authorization data, local runtime tokens, and private prompt content.

#### Scenario: Manifest validation fails
- **WHEN** a developer validates a manifest with an invalid contribution or missing permission
- **THEN** the tool reports a stable code, JSON path, human explanation, documentation link, and non-secret remediation

#### Scenario: Developer collects logs
- **WHEN** a developer runs `kun extension logs` for a failed extension
- **THEN** the command returns extension-scoped lifecycle and protocol diagnostics with credentials and private model payloads redacted

### Requirement: The public developer path is source-independent
A third-party developer SHALL be able to build, test, package, install, debug, and release every supported extension type using only the published SDKs, schemas, CLI, templates, examples, and documentation. No required workflow MUST depend on importing repository-private code, copying an internal IPC shape, or inspecting Kun implementation files.

#### Scenario: External acceptance project is built
- **WHEN** a clean project outside the Kun repository implements a documented View, Agent call, tool, and streaming provider against published artifacts
- **THEN** it passes validation and smoke tests on a compatible Kun installation without repository aliases or unpublished packages

#### Scenario: Internal contract changes
- **WHEN** Kun changes its Electron IPC, HTTP routing, or internal ModelClient implementation while preserving the public Extension API
- **THEN** previously compatible external acceptance projects continue to build and run unchanged
