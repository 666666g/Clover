## ADDED Requirements

### Requirement: Explicit routing includes the active provider
Kun SHALL route an explicit configured provider ID even when that provider also backs the runtime default client, and SHALL continue to reject genuinely unknown explicit provider IDs.

#### Scenario: Active provider is explicit
- **WHEN** a turn sends the active HTTP provider ID explicitly
- **THEN** Kun routes the request with that provider's credentials and endpoint rather than reporting an unknown provider

#### Scenario: Provider is genuinely unknown
- **WHEN** a turn sends a provider ID absent from the configured provider catalog
- **THEN** Kun rejects the turn before transport and does not fall back to different credentials

### Requirement: Model and provider selections remain coherent
The application SHALL persist and resolve a model ID together with the provider ID that exposes it across global composer settings, thread selections, turn overrides, and non-chat agent entry points.

#### Scenario: Global model switches provider
- **WHEN** the user selects a model belonging to a different provider with no active thread
- **THEN** the application persists both the new model ID and its provider ID

#### Scenario: Existing thread changes model
- **WHEN** the user changes the model for an active thread
- **THEN** the application stores and sends the thread-local model/provider pair without changing the global runtime pair

#### Scenario: Legacy settings contain a unique mismatch
- **WHEN** a stored model does not belong to the stored provider but belongs to exactly one configured provider
- **THEN** settings normalization repairs the provider ID to that unique provider

### Requirement: Subagents use a valid provider and model pair
Every delegated child SHALL resolve one coherent provider/model selection from explicit child configuration, profile configuration, parent inheritance, and runtime defaults before starting its model turn.

#### Scenario: Profile selects another provider
- **WHEN** a parent uses Codex and the selected subagent profile specifies a complete DeepSeek provider/model pair
- **THEN** the child routes through DeepSeek and the parent continues through Codex

#### Scenario: Profile inherits parent selection
- **WHEN** a subagent profile specifies neither provider nor model
- **THEN** the child inherits the parent's effective provider/model pair

#### Scenario: Child selection is ambiguous
- **WHEN** a partial child override cannot be mapped to one configured provider/model pair
- **THEN** delegation fails before model transport with an actionable configuration error

### Requirement: Failure diagnostics describe the failing request
Kun SHALL report the effective model ID and provider ID of the failing turn and SHALL keep provider ID, sanitized Base URL, and endpoint format as distinct diagnostic fields.

#### Scenario: Routed child fails
- **WHEN** a subagent request fails during provider resolution or model transport
- **THEN** the error identifies the child's effective model and provider rather than the runtime default model

#### Scenario: Diagnostic lookup encounters an unknown provider
- **WHEN** diagnostics inspect a request with an unknown provider ID
- **THEN** diagnostic collection remains non-throwing and preserves the original routing error

### Requirement: Routing coverage spans all agent entry points
The same provider/model routing invariants SHALL apply to Code, Write, Design, scheduled tasks, workflows, IM/Connect, reviews, primary-agent profiles, and delegated subagents.

#### Scenario: Non-Code turn selects a configured provider
- **WHEN** any non-Code entry point submits a configured provider/model pair
- **THEN** Kun routes it using the same explicit provider registry as a Code turn
