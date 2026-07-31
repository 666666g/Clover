## ADDED Requirements

### Requirement: Users can define virtual model route pools
The application SHALL persist enabled or disabled route pools with a unique public model id and one or more ordered concrete provider/model targets, and SHALL forbid targets from referencing another route pool.

#### Scenario: Same model uses multiple providers
- **WHEN** a user adds the same model id from three concrete providers to one pool
- **THEN** the pool is saved as one selectable public model without copying provider credentials

#### Scenario: Public alias matches a concrete model
- **WHEN** a user names a route pool `kimi-k3` while a concrete provider also exposes `kimi-k3`
- **THEN** selecting `kimi-k3` under the local relay routes through the pool while selecting it under the concrete provider remains a direct request

#### Scenario: Target reference is invalid
- **WHEN** a target references a missing provider, missing model, or another route pool
- **THEN** the application marks the target invalid and does not route requests to it

### Requirement: Route pools support five selection strategies
Kun SHALL support priority failover, round robin, weighted round robin, lowest EWMA latency, and stability-first adaptive routing among enabled eligible targets.

#### Scenario: Priority target fails
- **WHEN** the first priority target fails before content with a failover-eligible failure
- **THEN** Kun attempts the next eligible target in configured order

#### Scenario: Adaptive selection has health history
- **WHEN** eligible targets have different recent success rates and latency histories
- **THEN** adaptive routing prioritizes stability and uses latency as a secondary penalty

### Requirement: Target eligibility follows request capabilities
Kun SHALL exclude targets that cannot satisfy the request's image input, tool calling, reasoning, output limit, or context-window requirements.

#### Scenario: Vision request reaches a heterogeneous pool
- **WHEN** a pool contains text-only and vision-capable targets and the request includes an image
- **THEN** Kun selects only from vision-capable targets

#### Scenario: No target is capable
- **WHEN** no enabled target satisfies the request requirements
- **THEN** Kun returns a capability error without sending the request upstream

### Requirement: Failover is safe for streaming and tools
Kun SHALL fail over only before any response content is observed and SHALL never replay a request after text, reasoning, tool data, or generated image content begins.

#### Scenario: Rate limit occurs before output
- **WHEN** an upstream target returns a classified 429 before producing content
- **THEN** Kun records the failure and tries the next eligible target

#### Scenario: Stream fails after a tool delta
- **WHEN** an upstream target emits any tool-call data and subsequently fails
- **THEN** Kun forwards the failure and does not invoke another target

### Requirement: Provider failures are structured and actionable
Model failures SHALL preserve a sanitized message plus category, optional HTTP status, optional provider code, retry-after delay, failover permission, and actual target attribution.

#### Scenario: Authentication target fails
- **WHEN** a target returns HTTP 401 or 403 before output
- **THEN** Kun marks that target unhealthy, fails over, and retains an authentication diagnostic for the user

#### Scenario: Request itself is invalid
- **WHEN** a target returns a request-level 400, 413, or 422 error
- **THEN** Kun terminates without sending the same invalid request to other targets

### Requirement: Routing health is bounded and restart-safe
Kun SHALL maintain bounded target success, failure, EWMA latency, circuit, and route event state; SHALL persist metrics and event history; and SHALL reset circuit state after restart.

#### Scenario: Consecutive failures open a circuit
- **WHEN** a target reaches its configured consecutive-failure threshold
- **THEN** Kun excludes it until cooldown and permits only the configured half-open probes

#### Scenario: Runtime restarts
- **WHEN** Kun restarts after metrics were persisted
- **THEN** success and latency history is restored while every circuit starts closed

### Requirement: Virtual models appear across model selectors and telemetry
Enabled pools SHALL appear as multiple virtual models under one named local relay provider group in Kun model selection surfaces, while usage, route events, and diagnostics SHALL retain the public alias and actual provider/model target.

#### Scenario: One relay provider exposes multiple models
- **WHEN** the user enables two or more route pools with distinct public model ids
- **THEN** model selectors show one local relay provider containing every enabled public model id rather than one provider group per route pool

#### Scenario: Workflow selects a pool
- **WHEN** a workflow or scheduled task chooses a virtual model alias
- **THEN** its model request is routed through the same pool behavior as a Code turn

#### Scenario: Routed usage is inspected
- **WHEN** usage is recorded for a request served by a route pool
- **THEN** records identify both the requested alias and the concrete provider/model used

### Requirement: Route pools are manageable in provider settings
Settings > Providers SHALL provide a dedicated Advanced Local Relay workspace that represents one named local relay provider containing multiple routed models, with controls for creating, editing, reordering, testing, enabling, and deleting each model pool without exposing credentials.

#### Scenario: User adds another public model
- **WHEN** the user adds a routed model in an existing local relay provider
- **THEN** the new public model appears alongside the provider's existing models and retains an independent strategy, target list, failure policy, health policy, and test history

#### Scenario: User reorders priority targets
- **WHEN** the user drags a target above another target and saves
- **THEN** subsequent priority requests use the new order after hot configuration applies

#### Scenario: User tests a pool
- **WHEN** the user runs a complete route test
- **THEN** Kun starts a Runtime-owned asynchronous test and the UI reports its live attempted targets, latency, normalized result, and final selected target

#### Scenario: User leaves during a route test
- **WHEN** the user switches away from provider settings while a complete route test is queued or running and later returns
- **THEN** the test continues independently and the UI restores its current progress or retained result and recent history from Kun Runtime state

#### Scenario: Edited pool is not hot-applied yet
- **WHEN** the saved route-pool definition does not yet match the definition loaded by Kun Runtime
- **THEN** the UI disables complete route testing and reports that configuration synchronization is pending instead of testing stale or missing configuration
