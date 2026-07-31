## ADDED Requirements

### Requirement: Kun exposes enabled virtual models through a local catalog
When the gateway is enabled, Kun SHALL expose enabled valid route pool aliases from `GET /v1/models` using an OpenAI-compatible model-list response.

#### Scenario: Client lists models
- **WHEN** a local client requests `/v1/models`
- **THEN** the response lists each enabled valid public route alias and does not expose upstream credentials

### Requirement: Kun accepts OpenAI-compatible generation requests
The gateway SHALL implement streaming and non-streaming `/v1/chat/completions` and `/v1/responses` requests for supported text, image, tool, token-limit, reasoning, and cancellation inputs.

#### Scenario: Streaming chat completion succeeds
- **WHEN** a client requests a known alias with `stream: true`
- **THEN** Kun returns correctly framed OpenAI-compatible events while routing through the configured pool

#### Scenario: Responses tool call succeeds
- **WHEN** a `/v1/responses` request contains supported tools
- **THEN** Kun maps tool-call chunks to Responses events without executing tools locally

#### Scenario: Client cancels
- **WHEN** the HTTP client disconnects during generation
- **THEN** Kun aborts the active upstream request and does not start another target

### Requirement: Public aliases remain stable in gateway responses
Gateway responses SHALL report the requested virtual model alias while internal telemetry SHALL retain the concrete provider/model target.

#### Scenario: Failover changes providers
- **WHEN** a request succeeds through its second target after the first target fails
- **THEN** the API response model remains the requested alias and route telemetry identifies both attempts

### Requirement: Gateway errors use a stable compatible shape
The gateway SHALL return OpenAI-compatible error objects with a stable type and code, sanitized messages, and an appropriate HTTP status for unknown models, invalid requests, capability failures, and exhausted route pools.

#### Scenario: Alias is unknown
- **WHEN** a client requests a model that is not an enabled route pool
- **THEN** Kun returns a model-not-found error without contacting an upstream provider

#### Scenario: All targets fail
- **WHEN** every eligible target fails before content
- **THEN** Kun returns one sanitized aggregate error and keeps detailed target failures in local route events

### Requirement: Unauthenticated gateway access is loopback-only
Kun MUST refuse to enable the unauthenticated gateway unless its effective listener host is a loopback address.

#### Scenario: Runtime listens on loopback
- **WHEN** the gateway is enabled on `127.0.0.1`, `::1`, or localhost
- **THEN** the generation routes are available without a bearer token

#### Scenario: Runtime listens on a non-loopback host
- **WHEN** hot apply or startup enables the unauthenticated gateway on a non-loopback host
- **THEN** configuration is rejected with an actionable safety error

### Requirement: Gateway configuration hot-applies safely
Route pool and gateway configuration changes SHALL affect new requests without restarting Kun and SHALL not change the configuration snapshot of an active stream.

#### Scenario: Pool changes during a stream
- **WHEN** settings hot-apply while a gateway response is streaming
- **THEN** the active response completes against its original pool snapshot and later requests use the new configuration
