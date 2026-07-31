## ADDED Requirements

### Requirement: Single-owner runtime lifecycle
The main process SHALL route Kun startup, readiness, restart, configuration apply,
health monitoring, and shutdown transitions through one runtime supervisor with
single-flight operations and explicit states.

#### Scenario: Concurrent startup requests
- **WHEN** multiple callers request Kun while startup is in progress
- **THEN** they SHALL observe the same startup operation and one managed child

#### Scenario: Application shutdown during health recovery
- **WHEN** application shutdown begins while a health recovery is pending
- **THEN** recovery SHALL not start or retain a replacement child process

### Requirement: Runtime behavior compatibility
The refactor SHALL preserve binary resolution, generated configuration, health
ports, logs, startup timeouts, unexpected-exit reporting, and graceful/forced stop
behavior.

#### Scenario: Existing packaged startup
- **WHEN** the packaged app starts with an existing valid Kun configuration
- **THEN** the same process, readiness, health, and log behavior SHALL be observed
