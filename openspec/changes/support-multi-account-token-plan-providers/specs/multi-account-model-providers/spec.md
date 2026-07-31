## ADDED Requirements

### Requirement: Subscription presets support multiple provider accounts

The application SHALL allow every direct subscription preset and nested Token Plan mode to create multiple concrete provider profiles, while direct pay-as-you-go presets SHALL retain their existing preset-update behavior.

#### Scenario: User adds a second plan account
- **WHEN** a subscription preset already has one configured provider and the user selects that preset again
- **THEN** the application creates a new unsaved provider draft instead of replacing or updating the existing account

#### Scenario: User selects an existing API preset
- **WHEN** a direct pay-as-you-go preset already has its canonical provider profile and the user selects it again
- **THEN** the application keeps the existing confirm-and-update preset flow without creating another account

### Requirement: Account identities are unique and predictable

The application SHALL keep the canonical id and display name for the first account and SHALL append a monotonically increasing numeric suffix to both fields for later accounts.

#### Scenario: Three accounts are created
- **WHEN** the user creates three accounts from the `Kimi Code` subscription preset
- **THEN** their default identities are `Kimi Code`, `Kimi Code 2`, and `Kimi Code 3`, with distinct corresponding provider ids

#### Scenario: A previous account was deleted or renamed
- **WHEN** the highest existing family ordinal is 3 or a generated id/name collides with another configured provider
- **THEN** the next account uses the first ordinal above the family maximum that makes both id and case-insensitive display name unique

### Requirement: Preset behavior survives duplicated identities

Every preset-derived provider profile SHALL persist a validated preset id and access mode independently from its unique provider id, and existing canonical profiles SHALL gain equivalent behavior through backward-compatible inference.

#### Scenario: Duplicate account is reloaded
- **WHEN** a numerically suffixed Token Plan account is normalized after settings reload
- **THEN** it retains the preset endpoint, model profiles, capabilities, regional behavior, subscription badge, API-key validation, and locked provider identity

#### Scenario: Stored preset source is invalid
- **WHEN** a profile references an unknown preset or a Token Plan mode unsupported by that preset
- **THEN** normalization ignores the invalid source and treats the explicit profile as custom-compatible data

### Requirement: Accounts remain independent throughout model routing

Each account SHALL have its own provider id and credential binding, and all model selection, workflow, schedule, media, usage, and local route-target surfaces SHALL preserve that concrete provider identity.

#### Scenario: Two accounts expose the same model
- **WHEN** two accounts from one plan expose the same model id
- **THEN** users can select either provider account directly or add both provider/model pairs as separate local route targets without credential ambiguity

#### Scenario: One account credential changes
- **WHEN** the API key for one account is updated or that account is removed
- **THEN** the other accounts retain their own credentials, provider entries, and selectable models unchanged

### Requirement: Provider creation communicates account multiplicity

The provider-add dialog SHALL distinguish subscription account creation from preset refresh and SHALL show how many accounts of each subscription preset/mode are already configured.

#### Scenario: Plan already has configured accounts
- **WHEN** the add-provider dialog shows a subscription entry with two saved accounts
- **THEN** the entry indicates two configured accounts and selecting it starts creation of the next account
