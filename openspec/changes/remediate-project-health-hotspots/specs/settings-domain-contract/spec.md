## ADDED Requirements

### Requirement: Canonical settings domain rules
Shared domain owners SHALL define settings types, defaults, normalization, legacy
migration, provider capabilities, and saved shape for both main and renderer
consumers.

#### Scenario: Normalize legacy settings
- **WHEN** an existing supported legacy settings document is loaded
- **THEN** it SHALL produce the same current Kun/provider/workflow/IM settings and
  save without deprecated runtime blocks

### Requirement: Cross-layer field completeness
Every persisted settings field SHALL have consistent type, default, normalization,
IPC validation, patch, and UI behavior or be explicitly marked internal/read-only.

#### Scenario: Save provider endpoint configuration
- **WHEN** a user changes provider base URL, endpoint format, model, or capability
- **THEN** the validated saved value and all runtime consumers SHALL observe the
  same canonical setting
