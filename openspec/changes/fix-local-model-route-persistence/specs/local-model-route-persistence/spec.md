## ADDED Requirements

### Requirement: Current route configuration survives settings normalization
The application SHALL preserve route pools, local gateway settings, and provider account source metadata when loading current-version settings, migrating legacy settings, and saving unrelated settings changes.

#### Scenario: Current settings reload
- **WHEN** the application restarts with route pools and a local gateway already stored in the current settings file
- **THEN** the same routing configuration is loaded into the UI and projected into Kun without requiring the user to recreate it

#### Scenario: Unrelated setting changes
- **WHEN** a user changes a setting outside the provider routing workspace
- **THEN** the persisted route pools and local gateway settings remain unchanged

#### Scenario: Legacy settings contain current provider extensions
- **WHEN** a legacy settings document also contains route pools, local gateway state, or multi-account provider source metadata
- **THEN** migration preserves those fields while upgrading the legacy runtime fields

### Requirement: Saved routing intent is independent from Runtime availability
The application SHALL persist valid routing intent atomically before Runtime synchronization and SHALL retain it when Kun is stopped or a hot apply, restart, or synchronization attempt fails.

#### Scenario: Runtime is stopped during save
- **WHEN** a user edits a route while Kun Runtime is stopped
- **THEN** the edit is saved locally and is projected when Kun next starts

#### Scenario: Runtime synchronization fails
- **WHEN** a saved route configuration cannot be hot-applied or the fallback Runtime restart fails
- **THEN** the saved route pools and local gateway settings remain available for later synchronization and are not silently rolled back or cleared

### Requirement: Missing route references remain repairable
The application SHALL preserve structurally valid targets whose provider or model reference is missing, SHALL expose a derived reference status, and SHALL exclude invalid targets from executable Runtime configuration.

#### Scenario: Provider is removed
- **WHEN** a saved route target references a provider that no longer exists
- **THEN** the target remains visible with its original provider and model identifiers, is marked provider-missing, and is not sent to Kun as an executable target

#### Scenario: Model is removed
- **WHEN** the provider exists but no longer lists the target model
- **THEN** the target remains visible and is marked model-missing while Runtime routing excludes it

#### Scenario: Reference returns
- **WHEN** the missing provider and model identifiers become available again
- **THEN** the saved target becomes valid and eligible without the user recreating it

### Requirement: Save and Runtime synchronization states are distinct
The Advanced Local Relay workspace SHALL separately report local persistence and effective Kun Runtime synchronization, and SHALL only start a complete-chain test against a saved configuration that matches the Runtime projection.

#### Scenario: Edit is waiting for Runtime
- **WHEN** a route edit has been saved but Kun reports a different effective configuration
- **THEN** the UI reports synchronization pending and disables complete-chain testing with an actionable reason

#### Scenario: Synchronization takes longer than the UI threshold
- **WHEN** Runtime synchronization remains in progress while the saved and effective configurations differ
- **THEN** the UI continues to report synchronization pending and does not infer failure from elapsed time

#### Scenario: Runtime synchronization explicitly fails
- **WHEN** the main process reports that the latest hot apply or fallback restart failed
- **THEN** the UI reports synchronization failure with the returned reason while retaining the locally saved route configuration

#### Scenario: Rapid route edits are coalesced
- **WHEN** multiple automatic saves occur while a Runtime apply is already running
- **THEN** the current apply is allowed to finish and only the newest pending configuration is applied next

#### Scenario: Runtime is unavailable
- **WHEN** the route status endpoint cannot be reached
- **THEN** the UI reports that local settings remain saved, identifies Runtime as unavailable, and does not start a chain test

#### Scenario: Configuration is synchronized
- **WHEN** Kun reports route pools and local gateway state matching the saved executable projection
- **THEN** the UI reports synchronization success and allows complete-chain testing for an enabled route with at least one valid enabled target

### Requirement: Route status reports effective gateway configuration
Kun SHALL return its effective local gateway enabled state together with its effective route pools, health metrics, route events, and chain-test records.

#### Scenario: Status is inspected after hot apply
- **WHEN** an authenticated client requests `GET /v1/model-routes` after routing configuration is applied
- **THEN** the response identifies the effective local gateway enabled state and effective route pool definitions without exposing upstream credentials
