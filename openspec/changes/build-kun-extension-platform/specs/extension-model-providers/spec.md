## ADDED Requirements

### Requirement: Extensions can contribute complete model providers
Kun SHALL let an enabled extension with a Node `main` entry register namespaced model provider definitions and executable adapters without adding another Agent runtime. A provider contribution MUST identify its owning extension, authentication provider, advertised models and capabilities, and the adapter API version it implements.

#### Scenario: Provider contribution is activated
- **WHEN** a compatible enabled extension contributes a valid model provider and its Node host activates
- **THEN** Kun registers the provider and exposes its models through the same catalog and selection surfaces as built-in providers

#### Scenario: Executable provider lacks a Node entry
- **WHEN** an extension declares a model provider that can be selected for headless execution but has no Node `main` entry
- **THEN** package validation rejects the contribution before the extension can be enabled

#### Scenario: Provider identifier collides
- **WHEN** two extensions attempt to register the same provider identifier or an extension attempts to use a reserved built-in identifier
- **THEN** Kun rejects the conflicting registration and leaves the previously valid provider catalog unchanged

### Requirement: Provider adapters implement a stable lifecycle contract
The public provider contract SHALL expose `probe`, `listModels`, `stream`, and `cancel`, plus optional `countTokens`. Kun MUST invoke each operation through the owning Extension Host, MUST correlate calls with opaque request identifiers, and MUST release in-flight operations when the extension is deactivated or its host terminates.

#### Scenario: Provider connection is probed
- **WHEN** a user or headless caller tests an extension provider with a valid account binding
- **THEN** Kun calls `probe` and returns a normalized success or structured provider error without starting an Agent turn

#### Scenario: Token counting is not implemented
- **WHEN** Kun requests a token estimate from a provider that does not implement `countTokens`
- **THEN** Kun uses its core estimation path and does not treat the optional operation as an adapter failure

#### Scenario: Provider is deactivated during a request
- **WHEN** an extension provider is disabled or its host exits while one or more operations are active
- **THEN** Kun cancels or fails every affected operation with a terminal structured error and releases their request state

### Requirement: Model requests cross a normalized public boundary
Kun SHALL translate an Agent model turn into a versioned provider request containing the effective provider ID, account handle, model ID, system and mode instructions, prefix and history items, attachments, advertised tool schemas, generation controls, and an opaque request ID. The public request MUST NOT expose Kun-internal classes, runtime tokens, filesystem credentials, or JavaScript `AbortSignal` objects.

#### Scenario: Full multimodal tool-capable request is routed
- **WHEN** an Agent turn contains text history, an attachment, reasoning controls, and advertised tools and selects an extension provider
- **THEN** the provider receives their normalized public representations together with the effective account handle and model selection

#### Scenario: Request cancellation is requested
- **WHEN** the Agent turn is interrupted after its normalized request has been dispatched
- **THEN** Kun sends a separate cancellation operation for the same opaque request ID instead of serializing an internal abort object

#### Scenario: Unsupported request capability is selected
- **WHEN** a request requires an input modality, tool mode, or generation control that the selected model did not advertise
- **THEN** Kun rejects the request before transport with a capability error identifying the provider and model

### Requirement: Provider streams use canonical ordered events
An extension provider SHALL emit only versioned normalized stream events for text deltas, reasoning deltas, tool-call deltas, completed tool calls, usage, completion, or error. Kun MUST preserve event order per request, MUST assemble fragmented tool calls by call ID, MUST accept at most one terminal outcome, and MUST reject malformed or over-budget stream data without committing an invalid model history.

#### Scenario: Provider streams text and reasoning
- **WHEN** a provider emits interleaved text and reasoning deltas followed by usage and completion
- **THEN** Kun projects the deltas in order, records normalized usage, and completes the model round once

#### Scenario: Provider fragments parallel tool calls
- **WHEN** a provider interleaves names and argument fragments for multiple tool-call IDs
- **THEN** Kun reconstructs each call independently, preserves first-seen call order, and exposes one completed call per ID

#### Scenario: Provider emits malformed stream data
- **WHEN** a provider emits an unknown event, exceeds a configured event or payload budget, completes a tool call with invalid arguments, or emits a second terminal outcome
- **THEN** Kun terminates the request with a structured protocol error and does not append malformed assistant or tool-call history

#### Scenario: Usage arrives with completion
- **WHEN** the provider reports prompt, output, cache, or cost usage before or with its terminal event
- **THEN** Kun normalizes the available fields into the existing usage accounting path without inventing unavailable values

### Requirement: Streaming applies cancellation and backpressure
Kun SHALL propagate turn interruption and stream timeouts to `cancel`, SHALL bound queued stream events and payload bytes, and SHALL stop accepting events after cancellation or a terminal outcome. A slow consumer MUST apply backpressure rather than permit unbounded Extension Host or Kun memory growth.

#### Scenario: User interrupts a streaming turn
- **WHEN** the user cancels an active turn routed through an extension provider
- **THEN** Kun calls the adapter's `cancel` operation, stops projecting later events, and records the turn as interrupted

#### Scenario: Provider ignores cancellation
- **WHEN** an adapter continues emitting events after cancellation or exceeds the cancellation grace period
- **THEN** Kun discards the late events, terminates the request state, and applies Extension Host enforcement without leaving the turn active

#### Scenario: Consumer falls behind
- **WHEN** provider events arrive faster than Kun can validate and consume them
- **THEN** the host bridge pauses or bounds delivery and fails the request if the documented queue budget is exceeded

### Requirement: Provider model discovery is authoritative and normalized
Kun SHALL combine manifest-declared model metadata with the adapter's `listModels` result into a normalized provider-owned catalog. Every model entry MUST have a stable ID and explicit capability metadata, and dynamically discovered models MUST remain scoped to the provider that returned them.

#### Scenario: Provider lists dynamic models
- **WHEN** `listModels` returns valid models not statically declared in the manifest
- **THEN** Kun adds normalized provider/model pairs to that provider's selectable catalog for the current registration

#### Scenario: Model discovery returns invalid or duplicate entries
- **WHEN** `listModels` returns a malformed model, a duplicate model ID, or an ID owned by another provider
- **THEN** Kun rejects or de-duplicates the invalid entries deterministically and reports diagnostics against the owning extension

#### Scenario: Discovery is unavailable
- **WHEN** `listModels` fails but the provider has valid manifest-declared models
- **THEN** Kun retains the declared catalog, reports the discovery failure, and does not borrow models from another provider

### Requirement: Extension providers run without the desktop GUI
The Extension Manager owned by Kun SHALL activate Node provider adapters for `kun serve` and headless execution paths without requiring Electron, a renderer, or a Webview. Stored provider and account bindings SHALL resolve identically for GUI, scheduled, workflow, IM, delegated, and CLI Agent turns.

#### Scenario: Headless turn selects an extension provider
- **WHEN** `kun serve` or a headless Kun execution receives a valid extension provider, account, and model binding while the desktop GUI is closed
- **THEN** Kun activates the provider's Node host and streams the turn through the same adapter contract used by GUI turns

#### Scenario: Headless authentication needs interaction
- **WHEN** a headless request selects an account that requires new user authorization
- **THEN** Kun returns a structured interaction-required error and does not attempt to open or depend on a renderer-owned login surface

### Requirement: Provider routing never silently falls back
Kun SHALL resolve an explicit provider, account, and model as one coherent binding before model transport. An unknown, incompatible, disabled, uninstalled, crashed, or unavailable extension provider MUST fail explicitly and MUST NOT route the request to the default provider, a different account, or a same-named model from another provider.

#### Scenario: Explicit provider is unavailable
- **WHEN** a turn selects an extension provider whose extension is disabled, missing, incompatible, or crash-disabled
- **THEN** Kun rejects the turn before sending conversation content to any model transport and identifies the selected provider as unavailable

#### Scenario: Provider crashes mid-stream
- **WHEN** the selected provider host exits after receiving a model request
- **THEN** Kun fails that request with an extension-provider error and does not retry it through a built-in or different provider

#### Scenario: Model belongs to another provider
- **WHEN** a binding combines an extension provider with a model ID available only from a different provider
- **THEN** Kun rejects the incoherent binding and does not repair it by changing providers implicitly

### Requirement: Provider errors and diagnostics protect private data
Kun SHALL normalize adapter failures into stable error categories that retain the extension ID, provider ID, model ID, request ID, operation, and retryability. Diagnostics, logs, and user-visible errors MUST redact account secrets, authorization headers, raw credential payloads, runtime tokens, and full prompt or attachment bodies by default.

#### Scenario: Upstream authentication fails
- **WHEN** an extension provider reports an authentication or authorization failure
- **THEN** Kun associates the error with the selected account and provider using non-secret identifiers and marks reauthentication as required when applicable

#### Scenario: Adapter includes a secret in an error
- **WHEN** an adapter error or diagnostic field contains a known credential or authorization value
- **THEN** Kun redacts that value before persistence, telemetry, or display

### Requirement: Users are informed when a provider receives conversation data
Kun SHALL disclose that a Node provider adapter can receive complete model requests, including conversation history, instructions, attachments, and tool schemas. The provider MUST NOT become selectable until its extension permissions are accepted, and first use of a provider with newly expanded data access MUST require renewed acknowledgement.

#### Scenario: User first selects an extension provider
- **WHEN** the user attempts to bind a thread or profile to an extension-defined provider for the first time
- **THEN** Kun displays the provider owner and categories of data it can receive before persisting the binding

#### Scenario: Provider update expands access
- **WHEN** an installed provider version adds a permission or input-data capability not previously accepted
- **THEN** Kun disables use of that version until the user explicitly accepts the expanded disclosure
