## ADDED Requirements

### Requirement: Model import uses independent provider and catalog sources
The system SHALL request the configured provider's model list and the accurately matched models.dev provider catalog when a user starts model import, while connection testing SHALL continue to use only the configured provider request.

#### Scenario: Both sources succeed
- **WHEN** the configured provider returns model IDs and an exact models.dev provider mapping is available
- **THEN** the import dialog contains the merged entries from both sources with source provenance preserved

#### Scenario: Connection test runs
- **WHEN** the user tests a provider connection without importing models
- **THEN** the system does not request models.dev and reports the configured provider probe result unchanged

### Requirement: Catalog provider matching is deterministic
The system MUST match models.dev providers through maintained profile identifiers and normalized exact base URLs, including supported Token Plan, Coding Plan, and regional variants, and MUST NOT use fuzzy provider matching.

#### Scenario: Supported regional Token Plan URL
- **WHEN** a known Token Plan profile uses one of its supported regional base URLs
- **THEN** the system selects the corresponding regional models.dev provider key

#### Scenario: Unknown custom provider
- **WHEN** neither the profile identifier nor normalized base URL has an exact mapping
- **THEN** the catalog result reports `unmapped` without guessing a provider

#### Scenario: Subscription provider
- **WHEN** a ChatGPT or Claude subscription profile is matched for enrichment
- **THEN** models.dev metadata may enrich provider-confirmed IDs but catalog-only models are not offered

### Requirement: Catalog access is bounded and credential-safe
The system SHALL fetch the public models.dev catalog lazily in the main process with timeout and response-size limits, configured proxy support, in-memory freshness caching, concurrent request deduplication, and conditional refresh support, and MUST NOT transmit configured provider credentials.

#### Scenario: Fresh cached catalog
- **WHEN** a second import occurs within the catalog freshness interval
- **THEN** the system reuses the parsed in-memory catalog without another full network request

#### Scenario: Cached refresh fails
- **WHEN** a catalog refresh fails after a prior catalog has been parsed successfully
- **THEN** the system returns the matched cached entries marked as stale

#### Scenario: Catalog response exceeds limits
- **WHEN** the public response exceeds the configured size or time bound
- **THEN** the catalog source reports an error without blocking a successful provider-model result

### Requirement: Imported models expose source and capability information
The model import dialog SHALL deduplicate model IDs case-insensitively, prefer provider-API casing, display source and available capability metadata, and allow filtering by source.

#### Scenario: Same model appears in both sources
- **WHEN** the provider API and models.dev return IDs differing only by letter case
- **THEN** one row is shown using provider-API casing and marked as present in both sources

#### Scenario: Catalog-only model appears
- **WHEN** models.dev lists a model absent from the configured provider response
- **THEN** the row is visible, labeled as catalog-only, and unselected by default

#### Scenario: Capability data is available
- **WHEN** a catalog model provides limits, modality, tool-calling, or reasoning metadata
- **THEN** the import row displays the applicable capability badges and details

### Requirement: Source failures degrade independently
The system SHALL allow import from either source when it provides usable entries and SHALL expose a source-specific warning for the failed or unavailable source.

#### Scenario: Catalog fails after provider succeeds
- **WHEN** the configured provider returns models but models.dev fails or is unmapped
- **THEN** provider models remain importable and the dialog explains that catalog enrichment is unavailable

#### Scenario: Provider fails after catalog succeeds
- **WHEN** the configured provider request fails but the mapped models.dev catalog returns models
- **THEN** the dialog opens with catalog entries unchecked and warns that their account availability was not verified

#### Scenario: Both sources fail
- **WHEN** neither source supplies usable model entries
- **THEN** the system does not open an empty import dialog and reports the combined failure

### Requirement: Import safely enriches model profiles
The system SHALL map supported models.dev limits and capabilities into the existing model profile schema for imported models without overwriting deliberate existing provider, preset, or user configuration.

#### Scenario: New chat model is imported
- **WHEN** a selected model has models.dev context, output, image-input, or tool-calling metadata and no existing model profile
- **THEN** the provider stores a profile containing the supported mapped runtime fields

#### Scenario: Existing profile lacks only limits
- **WHEN** a selected existing model profile has no context or output limit but already defines modality or protocol behavior
- **THEN** the system fills missing limits and preserves the existing behavior fields

#### Scenario: Existing profile conflicts with catalog
- **WHEN** an existing profile explicitly defines a modality, tool-calling, endpoint, aliases, response mode, or reasoning setting that differs from models.dev
- **THEN** the existing profile value remains unchanged

#### Scenario: Catalog reports unsupported metadata
- **WHEN** a model includes descriptions, prices, dates, lifecycle status, or unsupported modalities
- **THEN** those fields are not written into persisted provider settings
