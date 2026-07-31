## ADDED Requirements

### Requirement: One Kun-owned extension manager
The active Kun runtime SHALL own one `ExtensionManager` composition service used
by `kun serve`, `kun exec`, and GUI-triggered extension operations. Electron and
renderer code SHALL reach background extensions through the Kun runtime boundary
and MUST NOT embed a second Agent loop, model runtime, or independent extension
runtime.

#### Scenario: GUI activates a background extension
- **WHEN** a GUI contribution needs its Node background entrypoint
- **THEN** the request SHALL cross the existing Kun runtime boundary and SHALL be handled by the same Extension Manager used for headless execution

#### Scenario: Headless command activates an extension
- **WHEN** `kun exec` triggers an extension activation event with no Electron process running
- **THEN** the Kun-owned Extension Manager SHALL activate the eligible Node entrypoint without starting a GUI or another Agent runtime

### Requirement: Node extensions are isolated by process
The Extension Manager SHALL isolate each active Node extension in its own process.
For each active extension with a Node `main` entrypoint, it SHALL launch at most
one dedicated child process for that extension version in a
Kun runtime instance. It SHALL NOT load third-party Node code into the Kun server
process or share a child process between extension identities.

The child SHALL start with a minimal inherited environment and an
extension-specific working directory. Process separation SHALL provide lifecycle,
resource, and crash isolation, but MUST NOT be represented as an operating-system
security sandbox because extension code retains the current user's Node and OS
privileges.

#### Scenario: Two Node extensions activate
- **WHEN** two distinct extension identities activate in the same Kun runtime
- **THEN** Kun SHALL run them in distinct child processes and SHALL route calls by their parent-bound identities

#### Scenario: Browser-only extension activates a view
- **WHEN** an extension has only a `browser` entrypoint and opens a GUI view
- **THEN** Kun SHALL NOT create a Node child process for that extension

#### Scenario: Extension inspects its process environment
- **WHEN** a Node extension starts
- **THEN** its process SHALL receive only the runtime-approved environment baseline and SHALL use its extension-specific working directory

### Requirement: Headless contributions require a Node entrypoint
Kun SHALL require a valid Node entrypoint for every headless contribution. Any
extension contribution that claims headless tools, Agent profiles, model
providers, authentication handlers, scheduled work, or background commands SHALL
have a valid `main` entrypoint. A `browser` entrypoint SHALL never be used as a
fallback for headless execution.

#### Scenario: Package declares a headless tool without main
- **WHEN** validation encounters a tool or provider contribution that must operate headlessly but the manifest has no valid `main` entrypoint
- **THEN** Kun SHALL reject the contribution before installation or development activation with an actionable manifest error

#### Scenario: GUI is closed during a provider request
- **WHEN** `kun serve` routes a model request through an enabled extension provider while no GUI or browser entrypoint is active
- **THEN** the Node entrypoint SHALL continue to stream the provider request through the same Extension Manager

### Requirement: Activation is lazy, serialized, and event driven
The Extension Manager SHALL activate an extension only after a declared
activation event occurs, unless a required headless contribution declares an
eager runtime-start event. Concurrent activation requests for the same extension
version SHALL join one activation attempt, and the extension SHALL receive one
versioned Host Context only after compatibility and permission admission pass.

#### Scenario: Installed extension is never needed
- **WHEN** no declared activation event occurs during a Kun session
- **THEN** Kun SHALL not start that extension's Node process or execute its entrypoint

#### Scenario: Activation requests race
- **WHEN** multiple views or tool calls concurrently trigger the same inactive extension
- **THEN** Kun SHALL perform one activation attempt and SHALL resolve all callers from that attempt's outcome

#### Scenario: Activation exceeds its deadline
- **WHEN** an extension entrypoint does not complete activation within the configured startup deadline
- **THEN** Kun SHALL terminate or quarantine that activation, mark the extension unavailable, and return a structured activation-timeout error to waiting callers

### Requirement: Extension lifecycle is bounded and disposable
The Host Context SHALL provide an explicit disposable lifecycle. On disablement,
version switch, uninstall, Kun shutdown, or circuit opening, the Extension
Manager SHALL stop accepting new calls, signal cancellation to active calls,
invoke deactivation once when possible, dispose registered resources, and enforce
a deadline before terminating the child.

#### Scenario: Kun shuts down with an active extension
- **WHEN** runtime shutdown begins while an extension has active subscriptions and calls
- **THEN** Kun SHALL reject new calls, cancel active work, request one deactivation, and ensure the child cannot remain orphaned after the shutdown deadline

#### Scenario: Extension disposes a registration
- **WHEN** extension code disposes a command, tool, provider, listener, timer, or view-session registration
- **THEN** the host SHALL stop routing new activity to that registration and SHALL release its host-side resources idempotently

### Requirement: IPC is versioned, typed, and identity bound
Kun and each Node host SHALL communicate through framed, versioned JSON-RPC over
Node IPC. Every request, response, notification, stream item, cancellation, and
error SHALL satisfy the schema negotiated for that connection and SHALL use
bounded correlation identifiers and payload sizes.

The parent process SHALL bind extension identity, version, grants, and workspace
scope to the connection. The host MUST ignore any identity or permission claim
supplied by extension payload data, and extension code MUST NOT receive the Kun
runtime token or import Kun internal AgentLoop, ModelClient, ToolHost, Electron,
or server modules as public APIs.

#### Scenario: Extension spoofs another identity
- **WHEN** an extension request includes another extension ID or broader permission claim in its payload
- **THEN** Kun SHALL authorize and route the request using only the connection-bound identity and grants and SHALL reject any cross-extension target not explicitly allowed

#### Scenario: IPC payload is malformed or oversized
- **WHEN** a child sends a message that fails the negotiated schema or exceeds a configured message limit
- **THEN** Kun SHALL reject the message, attribute the protocol violation to that extension, and protect the server and other extensions from the payload

#### Scenario: Extension requests an internal object
- **WHEN** extension code attempts to access a runtime token or an unexported Kun internal service through the public Host Context
- **THEN** the host SHALL expose no such capability and SHALL return a structured unsupported-method error for broker calls

### Requirement: Broker calls enforce granted permissions
Every Host Context operation mediated by Kun SHALL check the connection-bound
permission grant, workspace trust and scope, and operation-specific policy before
dispatch. A Node process's direct OS access SHALL remain outside broker
enforcement and SHALL be disclosed as trusted-code behavior rather than described
as blocked.

#### Scenario: Broker permission is absent
- **WHEN** an extension invokes an Agent, workspace, network, account, shell, or registration method without its required grant
- **THEN** Kun SHALL deny the operation before dispatch with a structured permission error and SHALL record the extension identity in the audit event

#### Scenario: Node extension uses direct platform access
- **WHEN** trusted Node code bypasses the Host Context and uses Node APIs directly
- **THEN** Kun SHALL NOT claim the manifest broker permission prevented that access, and management diagnostics SHALL continue to identify the extension as trusted Node code

### Requirement: Host resource consumption is bounded
The Extension Manager SHALL enforce configured limits for activation time,
operation time, child memory, concurrent requests, queued work, IPC message size,
stream buffer size, and event rate. Limit enforcement against one extension MUST
NOT terminate Kun or an unrelated extension. Exceeded limits SHALL produce
structured errors and SHALL contribute to that extension's health state.

#### Scenario: Extension exceeds its memory limit
- **WHEN** a child process crosses the configured memory ceiling or exits because of its Node resource limit
- **THEN** Kun SHALL mark only that extension as crashed, fail its in-flight calls, and keep the runtime and other extension processes available

#### Scenario: Extension exceeds concurrency limit
- **WHEN** an extension has reached its allowed concurrent operation count
- **THEN** Kun SHALL reject or place work in its bounded queue according to the documented host policy and SHALL never grow an unbounded queue

#### Scenario: Extension emits events too quickly
- **WHEN** an extension produces stream or event data faster than its consumer acknowledges
- **THEN** the host SHALL apply bounded backpressure and SHALL cancel or fail that stream rather than retaining an unbounded in-memory event history

### Requirement: Calls and streams support cancellation
Every long-running host call SHALL have a host-generated request identifier and a
terminal outcome. Kun SHALL propagate cancellation, enforce a cancellation
deadline, ignore late non-terminal messages after termination, and release all
correlation and backpressure state.

#### Scenario: Caller cancels an extension operation
- **WHEN** a caller cancels a tool, provider stream, Agent-related call, or background command
- **THEN** Kun SHALL send cancellation for its request identifier, publish at most one terminal outcome, and free the request's bounded buffers

#### Scenario: Extension ignores cancellation
- **WHEN** an extension continues emitting for a request after its cancellation deadline
- **THEN** Kun SHALL discard late messages and SHALL apply the configured operation or process failure policy without affecting unrelated extension processes

### Requirement: Crashes are contained and circuit broken
Kun SHALL contain extension crashes and circuit-break repeated failures. An
unexpected child exit, uncaught activation error, or fatal protocol violation
SHALL fail only that extension's in-flight operations. Kun SHALL support a bounded
restart policy, SHALL count consecutive unhealthy starts or crashes, and SHALL
open a per-extension circuit after the configured threshold instead of restarting
indefinitely.

#### Scenario: One extension crashes
- **WHEN** an active extension child exits unexpectedly
- **THEN** Kun SHALL fail that extension's in-flight calls with an attributed error while the Agent runtime and other extensions remain operational

#### Scenario: Extension repeatedly crashes
- **WHEN** consecutive activation or runtime failures reach the configured circuit-breaker threshold
- **THEN** Kun SHALL stop automatic restarts for that extension, mark it circuit-open, and require an explicit user or developer retry, reload, version change, or re-enable action

#### Scenario: Extension is within restart budget
- **WHEN** an eligible extension crashes before reaching its restart threshold and its operation is safe to retry
- **THEN** Kun SHALL restart only that extension under the bounded policy and SHALL not silently replay side-effecting calls

### Requirement: Runtime status and logs are extension scoped
Kun SHALL expose per-extension lifecycle state, selected version, process ID when
active, activation cause, restart count, circuit state, resource-limit failures,
last structured error, and log location through extension management APIs and
CLI diagnostics. It SHALL capture timestamped, size-bounded, rotating stdout,
stderr, and host lifecycle logs identified by extension and process instance.

Kun-managed secrets MUST NOT be inserted into structured host logs or crash
diagnostics. This capability SHALL NOT reintroduce a general runtime diagnostics
panel or a second-provider runtime control surface.

#### Scenario: Developer diagnoses activation failure
- **WHEN** a developer runs extension diagnostics after activation fails
- **THEN** Kun SHALL report the affected identity, version, activation event, lifecycle state, bounded error, and relevant log location without exposing Kun-managed credentials

#### Scenario: Extension logs continuously
- **WHEN** an extension's log reaches its configured size or retention bound
- **THEN** Kun SHALL rotate and expire extension-scoped log files rather than permitting unbounded disk growth

### Requirement: Headless and GUI callers observe one extension state
Kun SHALL expose one consistent extension state to headless and GUI callers.
Enablement, selected versions, permissions, circuit state, activation results,
registrations, and extension-owned backend state SHALL be consistent across
`kun serve`, `kun exec`, and GUI clients attached to the same Kun data directory.
Headless mode SHALL permit browser view sessions to be absent, but their absence
MUST NOT change registered Node tool or provider behavior.

#### Scenario: GUI closes while Kun remains running
- **WHEN** the last GUI window closes but the configured Kun server continues and a Node tool or provider is active
- **THEN** backend extension registrations and eligible work SHALL remain available while GUI-only view sessions are closed

#### Scenario: CLI observes a disabled extension
- **WHEN** an extension is disabled through the GUI and a later headless command uses the same data directory
- **THEN** the headless Extension Manager SHALL observe the disabled state and SHALL not activate that extension
