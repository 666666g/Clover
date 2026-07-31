## ADDED Requirements

### Requirement: Extension Agent access uses the single Kun runtime
All extension Agent operations SHALL be brokered into the existing `kun serve` runtime and its AgentLoop, stores, EventBus, ApprovalGate, and ToolHost. An extension SHALL NOT receive a runtime token or instantiate a second Agent runtime, model loop, approval gate, or thread store inside the GUI or Extension Host.

#### Scenario: Extension starts an Agent run
- **WHEN** an authorized extension calls the public Agent API
- **THEN** the broker SHALL create or resume work through the single Kun runtime and SHALL NOT execute an Agent loop in the renderer or extension process

### Requirement: Stable public Agent API surface
The public SDK SHALL provide `agent.createRun`, `agent.subscribe`, `agent.steer`, `agent.cancel`, `agent.getRun`, `threads.listOwn`, and `threads.getOwn` with versioned request, response, event, and error schemas. Calls SHALL use the authenticated extension principal supplied by the host rather than an extension ID supplied in request data.

#### Scenario: Extension uses the documented API
- **WHEN** an extension creates a run, subscribes to it, reads its state, steers it, or cancels it
- **THEN** each operation SHALL return a schema-valid result or a stable structured error defined by the negotiated Extension API

#### Scenario: Extension forges an owner field
- **WHEN** a request body names another extension as the owner
- **THEN** the broker SHALL ignore the claimed identity and authorize the request using the host-bound caller principal

### Requirement: Runs and threads have durable extension ownership
Every extension-created run SHALL execute on a Kun thread persisted with `ownerExtensionId`, creating extension version, workspace scope, resolved profile, provider and account references, budget, and tool-catalog epoch. Ownership SHALL be the stable extension ID, while the creating version SHALL remain audit metadata.

#### Scenario: New run creates a thread
- **WHEN** an extension calls `agent.createRun` without an existing thread ID
- **THEN** Kun SHALL create a distinct extension-owned thread and return both thread and run identities

#### Scenario: Extension is upgraded
- **WHEN** a newer version of the same extension ID queries threads created by an older version
- **THEN** the broker SHALL treat them as owned by that extension and SHALL retain the original version in audit metadata

### Requirement: Existing thread reuse is owner checked
`agent.createRun` SHALL create a new extension-owned thread by default and SHALL resume an explicitly supplied thread only when it is owned by the caller, belongs to a compatible workspace scope, is not deleted, and is not already executing an incompatible active run. Main-workbench and other-extension threads SHALL NOT be adopted implicitly.

#### Scenario: Extension resumes its own thread
- **WHEN** an extension supplies the ID of an idle compatible thread it owns
- **THEN** Kun SHALL append the new run to that thread using its persisted ownership and catalog rules

#### Scenario: Extension supplies a user thread
- **WHEN** an extension supplies a main-workbench or foreign extension thread ID
- **THEN** the broker SHALL reject the request without revealing that thread's contents

### Requirement: Agent operations enforce permissions and workspace policy
Creating or controlling a run SHALL require the applicable Agent permission and SHALL enforce workspace enablement, workspace trust, file access, network, account, provider, and tool grants at both request and use time. Requested capabilities SHALL only narrow the caller's grants and SHALL NOT expand them.

#### Scenario: Run requests an ungranted workspace
- **WHEN** an extension requests a workspace outside its active grant
- **THEN** `agent.createRun` SHALL fail before creating a thread or invoking a model

#### Scenario: Permission is revoked during a run
- **WHEN** a capability needed by a later model or tool step is revoked
- **THEN** Kun SHALL deny that step even if the capability was present when the run began

### Requirement: Core quotas bound extension-requested budgets
An extension run SHALL declare or inherit limits for tokens, elapsed time, concurrent runs, model requests, tool invocations, and event retention. Kun SHALL clamp requested limits to host and user policy, record the effective budget, and terminate or reject work with a structured budget outcome when a hard limit is reached.

#### Scenario: Extension requests an excessive token budget
- **WHEN** `agent.createRun` requests a budget above the caller's allowed maximum
- **THEN** the returned run metadata SHALL contain the effective clamped budget rather than granting the requested maximum

#### Scenario: Active run exhausts a hard limit
- **WHEN** a run reaches its effective token, time, or invocation limit
- **THEN** Kun SHALL stop further model and tool work and SHALL emit exactly one terminal budget-exhausted outcome

### Requirement: Run lifecycle has one terminal outcome
Run state SHALL follow a validated lifecycle from creation through active or gated states to exactly one of completed, failed, cancelled, or budget-exhausted. Concurrent completion, cancellation, tool failure, extension disablement, and thread deletion SHALL be resolved by the Kun runtime so that no model or tool side effect occurs after the terminal fence.

#### Scenario: Completion races cancellation
- **WHEN** model completion and an authorized cancellation arrive concurrently
- **THEN** Kun SHALL persist and emit one terminal outcome and SHALL discard later work beyond that terminal fence

### Requirement: Extension events are ordered and replayable
Extension run subscriptions SHALL use a dedicated authenticated SSE or IPC multiplexing boundary backed by persisted Kun runtime events. Events SHALL carry run ID, thread ID, owner scope, event type, and monotonically increasing sequence, and `agent.subscribe` SHALL accept a last-seen sequence for gap-free persisted replay followed by live delivery.

#### Scenario: Subscriber reconnects after sequence 42
- **WHEN** an owner reconnects with sequence 42 while later events have been persisted
- **THEN** the broker SHALL deliver events with sequence greater than 42 in increasing order before forwarding live events

#### Scenario: Replay reaches a terminal run
- **WHEN** a subscriber reconnects after the run has ended
- **THEN** replay SHALL include the persisted terminal event exactly once relative to the supplied cursor and SHALL then close or mark the subscription complete

### Requirement: Event subscriptions are owner scoped and secret safe
The event broker SHALL authorize every subscription and replay request against the caller's extension ownership. Event payloads SHALL exclude runtime tokens, account secrets, protected consent tokens, hidden threads, and capability data not granted to the extension.

#### Scenario: Extension subscribes to a foreign run
- **WHEN** an extension supplies a run or thread ID it does not own
- **THEN** the broker SHALL reject the subscription without replaying any event or thread metadata

### Requirement: Event delivery applies bounded backpressure
The extension event boundary SHALL bound per-subscriber queues, message size, and delivery rate and SHALL NOT retain an unbounded in-memory copy of runtime history. A lagging subscriber SHALL receive a resumable overflow error or disconnect cursor, while durable events and terminal outcomes SHALL remain available from the persisted replay source.

#### Scenario: Subscriber stops reading events
- **WHEN** an extension subscriber exceeds its bounded pending-event allowance
- **THEN** the broker SHALL terminate or resynchronize that subscription with a last-delivered cursor and SHALL NOT drop the persisted run history

### Requirement: Steering is ordered and cannot resolve gates
`agent.steer` SHALL accept input only for an active run owned by the caller, persist it through Kun's SteeringQueue in accepted order, and expose its acceptance as a run event. Steering content SHALL NOT be interpreted as a tool approval, protected consent, account secret response, or `request_user_input` answer.

#### Scenario: Owner steers an active run
- **WHEN** an extension submits two valid steering messages to its active run
- **THEN** Kun SHALL queue and apply them in accepted order at supported AgentLoop boundaries

#### Scenario: Extension steers text resembling approval
- **WHEN** steering content claims that a pending external-effect tool is approved
- **THEN** the ApprovalGate SHALL remain pending until a valid host-controlled user decision arrives

### Requirement: Cancellation is idempotent and propagates downward
`agent.cancel` SHALL be owner checked and idempotent, propagate cancellation to active model requests and ToolHost calls, stop queued steering, and persist one cancelled terminal outcome. Tool or model output arriving after the cancellation fence SHALL NOT be appended as successful work.

#### Scenario: Owner cancels twice
- **WHEN** an extension sends repeated cancellation requests for the same owned run
- **THEN** both calls SHALL resolve consistently while the event log contains only one terminal cancellation

### Requirement: Thread query APIs expose only owned state
`threads.listOwn` and `threads.getOwn` SHALL expose paginated, bounded projections of extension-owned threads and runs without granting raw store access. The projection SHALL preserve thread status, timestamps, profile and usage metadata needed by the extension while redacting unrelated internal state and secrets.

#### Scenario: Extension lists its threads
- **WHEN** an extension queries its owned thread history with supported filters and pagination
- **THEN** the broker SHALL return only threads whose stable owner ID matches the authenticated extension

### Requirement: Agent profiles are manifest-declared and namespaced
An extension SHALL contribute Agent profiles through validated manifest metadata with local ID, display metadata, instruction overlay, default model and provider binding, allowed tool scope, effective budget defaults, and visibility. Profile identities SHALL be namespaced by extension ID, and invalid or unauthorized provider, account, model, tool, or permission references SHALL prevent profile registration.

#### Scenario: Extension creates a run from its profile
- **WHEN** `agent.createRun` references a valid profile contributed by the caller
- **THEN** Kun SHALL resolve the profile under that extension's namespace and apply only values allowed by current policy

#### Scenario: Profile references an ungranted account
- **WHEN** a profile selects an account the extension cannot use
- **THEN** profile resolution SHALL fail without disclosing the account secret or silently selecting another account

### Requirement: Profiles cannot replace Kun's stable system prefix
Extension profile instructions SHALL be treated as an attributed, bounded overlay after Kun's stable system and few-shot prefix. Extensions SHALL NOT replace, reorder, or mutate Kun's system contract, approval rules, tool-result history rules, immutable-prefix fingerprint inputs, or hidden runtime instructions.

#### Scenario: Profile supplies system-like instructions
- **WHEN** an extension profile includes instructions that conflict with Kun approval or ownership policy
- **THEN** Kun SHALL preserve its core policy and treat the extension content only as lower-priority profile context

### Requirement: Runs persist resolved profile snapshots
At run creation Kun SHALL resolve and persist the profile ID, contributing extension version, instruction digest, model and provider binding, budget, allowed tool scope, and tool-catalog epoch used by that run. Updating a manifest or profile SHALL affect new resolutions only and SHALL NOT silently rewrite an existing run's history.

#### Scenario: Profile changes during an existing thread
- **WHEN** an extension update changes a profile used by prior runs
- **THEN** prior run records SHALL retain their resolved snapshots and a later run SHALL record the newly resolved profile snapshot

### Requirement: Extensions register typed disposable tools
The public Tool API SHALL allow an activated extension with the required permission to register a tool using a local name, description, JSON input schema, optional bounded output metadata, side-effect declaration, and invocation handler. Successful registration SHALL return a disposable, and schema-invalid, duplicate, reserved, or policy-forbidden tools SHALL be rejected before entering the model catalog.

#### Scenario: Extension registers a valid tool
- **WHEN** an authorized extension registers a tool whose declaration matches its manifest and public schema
- **THEN** Kun SHALL make an attributed extension tool available through the Extension Tool Provider and return a lifecycle disposable

#### Scenario: Extension registers a reserved interactive tool name
- **WHEN** an extension attempts to register `request_user_input`, an approval tool, or another Kun-reserved identity
- **THEN** registration SHALL be rejected

### Requirement: Tool identities are deterministic and collision free
Kun SHALL derive each extension tool's canonical identity and model-safe alias from the authenticated extension ID and manifest-declared local tool name. Extensions SHALL NOT choose another extension's namespace, and two installed extensions with the same local tool name SHALL remain independently addressable without catalog collision.

#### Scenario: Two extensions register `create_issue`
- **WHEN** two different extension principals register the same local tool name
- **THEN** Kun SHALL assign distinct canonical identities and deterministic model-facing aliases to both

### Requirement: Extension tools execute through ToolHost
Every model-initiated extension tool invocation SHALL pass through Kun's ToolHost and Extension Tool Provider before reaching the owning extension process. The dispatch contract SHALL validate arguments, bind extension and tool identity, assign an invocation ID, propagate cancellation and deadlines, bound progress and result payloads, and normalize success or structured failure into valid tool history.

#### Scenario: Model calls an extension tool
- **WHEN** an eligible pinned tool call passes policy and argument validation
- **THEN** ToolHost SHALL dispatch it only to the registered owner and SHALL append its normalized result in model tool-call order

#### Scenario: Tool returns an oversized result
- **WHEN** an extension tool result exceeds the configured payload or history budget
- **THEN** Kun SHALL truncate, externalize, or reject it through the documented bounded-result contract without corrupting model history

### Requirement: Core approval policy cannot be weakened by extensions
An extension tool's side-effect declaration SHALL be treated as policy input and SHALL NOT override stricter Kun ApprovalGate, sandbox, workspace, or user policy. External side effects and other protected operations SHALL use the host-controlled approval flow, and an extension SHALL NOT approve its own or another tool call through Agent, tool, command, event, Webview, or content-script APIs.

#### Scenario: Extension marks an external-effect tool as read-only
- **WHEN** Kun policy classifies an invocation as requiring approval despite the extension declaration
- **THEN** ToolHost SHALL pause for a genuine protected user decision before dispatching the invocation

#### Scenario: Extension submits a fabricated approval result
- **WHEN** an extension sends a message shaped like an approval response
- **THEN** the broker SHALL reject it because it lacks the matching host-held consent and ApprovalGate identity

### Requirement: Extensions cannot answer interactive user gates
Pending `user_input` or `request_user_input` gates SHALL be resolved only through Kun's authenticated user interaction boundary. Extensions SHALL receive only the permitted pending-state event and SHALL NOT have an API to fabricate, cancel, or answer the user's protected response.

#### Scenario: Headless extension run requests user input
- **WHEN** a run reaches `request_user_input` while no trusted user surface is attached
- **THEN** the run SHALL remain gated or end according to explicit headless policy and SHALL NOT synthesize an extension-provided answer

### Requirement: Invocation-time authorization is mandatory
Kun-mediated workspace, network, account, provider, and secret capabilities used by an extension tool SHALL be authorized again for each invocation against current extension, workspace, and user grants. Registration success or thread catalog membership SHALL NOT preserve a revoked capability.

#### Scenario: Network grant is revoked after catalog creation
- **WHEN** a pinned extension tool later attempts brokered network access after its network grant was revoked
- **THEN** the broker SHALL deny the access and ToolHost SHALL record a structured permission failure

### Requirement: Tool disposal and extension disablement stop execution safely
Disposing a tool, deactivating, disabling, or uninstalling its extension SHALL prevent new dispatch immediately and SHALL cancel pending or running invocations when cancellation is supported. It SHALL NOT delete prior tool-call history or rewrite the catalog fingerprint recorded for completed turns.

#### Scenario: Extension is disabled during a tool call
- **WHEN** an extension is disabled while one of its tools is in flight
- **THEN** ToolHost SHALL request cancellation, fence late success output, and persist an attributed unavailable or cancelled result

### Requirement: Unknown tool outcomes are not replayed unsafely
Kun SHALL distinguish failures before dispatch, failures with a known non-executed outcome, and failures after dispatch with an unknown side-effect outcome. It SHALL NOT automatically retry an extension tool with possible side effects unless the public tool contract declares idempotency and the retry reuses a stable invocation key accepted by policy.

#### Scenario: Extension process exits after receiving a side-effect call
- **WHEN** ToolHost cannot determine whether the extension completed the effect
- **THEN** the run SHALL receive an unknown-outcome failure and SHALL NOT automatically issue a second invocation

### Requirement: Each thread pins a canonical tool catalog epoch
At thread or explicit catalog-epoch creation, Kun SHALL build a permission-eligible tool snapshot, canonicalize tool order and schemas, and persist its epoch ID, fingerprint, tool count, canonical identities, and per-tool schema digests. All model steps in that epoch SHALL use the pinned catalog inputs so ordinary extension activation order cannot change the immutable model prefix.

#### Scenario: Equivalent tools register in different order
- **WHEN** two new threads resolve the same eligible tool definitions in different activation order
- **THEN** canonicalization SHALL produce the same catalog fingerprint and model tool order

#### Scenario: Tool schema mutates during a run
- **WHEN** the live registry no longer matches the active epoch snapshot
- **THEN** Kun SHALL preserve the pinned model catalog for that epoch and SHALL report drift rather than silently rewriting the prefix

### Requirement: Catalog changes require a new boundary
Installing, enabling, disabling, removing, or changing an extension tool SHALL affect new threads or an explicitly created catalog epoch and SHALL NOT mutate a model round already in progress. Creating a new epoch SHALL occur only at an idle thread boundary, SHALL be persisted before the next model request, and SHALL produce a new canonical fingerprint.

#### Scenario: User enables a tool extension mid-turn
- **WHEN** a thread has an active model round and an extension tool becomes enabled
- **THEN** that round SHALL retain its existing epoch and the new tool SHALL become eligible only after a valid new catalog boundary

#### Scenario: Disabled tool remains in an old snapshot
- **WHEN** policy disables a tool recorded in an existing epoch
- **THEN** execution SHALL be blocked immediately while the persisted historical snapshot remains unchanged for replay and cache diagnostics

### Requirement: Catalog drift is fenced before upstream requests
Before every model step, Kun SHALL verify the immutable prefix and active tool-catalog fingerprint. Breaking edits, removals, reordering, or schema changes outside a valid epoch transition SHALL prevent the request or force the documented new-epoch path rather than causing silent prompt-cache churn.

#### Scenario: Registered schema changes without an epoch
- **WHEN** a tool provider exposes a different schema digest for a tool pinned to the active epoch
- **THEN** Kun SHALL emit catalog-drift diagnostics and SHALL NOT send the mutated catalog as though the prefix were unchanged

### Requirement: Large extension catalogs use stable progressive discovery
Kun SHALL avoid inserting every installed extension tool schema into every model request. When the eligible catalog exceeds the direct-exposure policy, Kun SHALL expose stable, core-owned discovery and call gateway schemas; discovery SHALL search only the pinned, permission-eligible epoch, and gateway calls SHALL still pass through ToolHost, authorization, approval, budgets, and cancellation.

#### Scenario: Many extensions contribute tools
- **WHEN** a thread resolves more extension tools than the direct catalog policy permits
- **THEN** the model prefix SHALL retain the stable discovery and call gateway schemas instead of all installed extension schemas

#### Scenario: Discovery finds a disabled foreign tool
- **WHEN** a search query could match a tool outside the caller's pinned and authorized epoch
- **THEN** discovery SHALL omit that tool and the call gateway SHALL reject attempts to invoke it by guessed identity

### Requirement: Agent and tool capabilities operate headlessly
Node extension Agent APIs, profiles, and registered tools SHALL operate under `kun serve` or supported CLI execution without an Electron renderer. Headless operation SHALL retain the same ownership, permissions, budgets, catalog, approval, cancellation, and event persistence rules and SHALL never auto-approve an interaction because no GUI is present.

#### Scenario: Headless run calls a non-interactive extension tool
- **WHEN** an enabled Node extension creates a run under `kun serve` with no GUI and the run invokes an authorized non-interactive tool
- **THEN** Kun SHALL dispatch and persist the invocation through the same ToolHost contract used by the desktop app

### Requirement: Usage and audit remain attributable
Kun SHALL attribute model usage, cache telemetry, tool invocations, approvals, failures, and terminal outcomes to extension ID, creating extension version, run, thread, profile, provider, model, account reference, and catalog epoch. Audit and SDK projections SHALL redact account secrets, prompts beyond the caller's owned thread, consent tokens, and runtime credentials.

#### Scenario: Extension inspects a completed run
- **WHEN** the owner calls `agent.getRun` after completion
- **THEN** the result SHALL include effective budget and attributable usage and terminal metadata without exposing protected credentials
