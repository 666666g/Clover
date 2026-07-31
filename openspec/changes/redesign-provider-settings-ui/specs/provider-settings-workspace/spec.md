## ADDED Requirements

### Requirement: Task-oriented provider workspace
The settings UI SHALL present providers through a responsive master-detail workspace with Connection, Models, Capabilities, and Advanced task views while preserving access to every existing provider setting.

#### Scenario: Wide provider workspace
- **WHEN** the provider settings category has sufficient horizontal space
- **THEN** grouped provider navigation remains visible beside the active provider task view

#### Scenario: Compact provider workspace
- **WHEN** the provider settings category does not have sufficient horizontal space
- **THEN** provider navigation becomes a compact selector above a full-width task view

#### Scenario: Switching providers
- **WHEN** the user selects another persisted provider
- **THEN** the workspace displays that provider while keeping the current task tab selected

### Requirement: Distinct provider feedback
The settings UI SHALL distinguish configuration readiness, settings auto-apply state, and connection probe state.

#### Scenario: Invalid connection configuration
- **WHEN** a provider is missing a required credential or has an invalid service URL
- **THEN** the UI identifies the configuration issue and prevents an invalid connection probe

#### Scenario: Connection details change
- **WHEN** a credential, base URL, or endpoint format changes after a probe
- **THEN** the previous probe result is no longer presented as current

#### Scenario: Settings save fails
- **WHEN** auto-applying settings fails
- **THEN** the provider header exposes the save failure separately from connection status

### Requirement: Searchable provider creation
The settings UI SHALL create providers through a searchable preset dialog and SHALL keep a new provider local until the user explicitly confirms it.

#### Scenario: Add a preset provider
- **WHEN** the user selects a provider preset
- **THEN** the dialog closes and a local provider draft opens on the Connection task view

#### Scenario: Cancel a provider draft
- **WHEN** the user cancels the draft
- **THEN** no provider profile is persisted and the previously active provider is restored

#### Scenario: Confirm a provider draft
- **WHEN** the user confirms a valid draft
- **THEN** the existing provider persistence and activation rules are applied

#### Scenario: Select an installed preset
- **WHEN** the user selects a preset already present in settings
- **THEN** the existing preset update confirmation behavior remains available

### Requirement: Focused model management
The settings UI SHALL keep the unified model catalog in the Models task view and SHALL add or edit a model through a focused dialog with the existing validation and capability semantics.

#### Scenario: Add or edit a model
- **WHEN** the user starts adding a model or configures an existing model
- **THEN** a labeled dialog presents the relevant model fields without expanding the provider workspace vertically

#### Scenario: Cancel model editing
- **WHEN** the user cancels model editing
- **THEN** no model changes are applied

#### Scenario: Manage a large catalog
- **WHEN** a provider has more models than the existing page-size threshold
- **THEN** search, pagination, visible-page selection, and batch deletion remain available

### Requirement: Progressive provider capabilities
The settings UI SHALL summarize image, speech recognition, speech generation, music, and video capabilities and SHALL reveal protocol, endpoint, and model controls only when that capability is enabled and opened.

#### Scenario: Enable a capability
- **WHEN** the user enables a disabled capability
- **THEN** the existing preset-derived or default capability configuration is created and its configuration controls become available

#### Scenario: Disable a capability
- **WHEN** the user disables a capability
- **THEN** the existing capability removal behavior is applied

### Requirement: Global proxy separation
The settings UI SHALL display global proxy settings outside the active provider detail and collapsed by default.

#### Scenario: Configure the global proxy
- **WHEN** the user expands the global network proxy section and edits it
- **THEN** the existing global proxy settings are auto-applied without implying they belong only to the selected provider
