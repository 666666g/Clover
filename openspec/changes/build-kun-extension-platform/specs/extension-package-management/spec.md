## ADDED Requirements

### Requirement: Canonical extension package and identity
Kun SHALL accept distributable extensions as `.kunx` archives whose root contains
`kun-extension.json`, a package integrity manifest, README, LICENSE, declared
entrypoints, and all referenced local assets. An extension identity SHALL be the
immutable `publisher.name` value, and the package version SHALL be a valid SemVer
version.

The manifest SHALL declare `manifestVersion`, `apiVersion`, `engines.kun`,
`activationEvents`, `contributes`, `permissions`, and `stateSchemaVersion`, and
SHALL declare at least one `main` or `browser` entrypoint. An optional signature
SHALL be treated as provenance evidence rather than as a prerequisite for local
installation.

#### Scenario: Valid package is inspected
- **WHEN** a user selects a `.kunx` archive with a valid identity, SemVer version, manifest, integrity manifest, documentation, license, entrypoint, and assets
- **THEN** Kun SHALL expose its metadata, source, digest, compatibility, signature status, contributions, and requested permissions before installation

#### Scenario: Required package content is missing
- **WHEN** a `.kunx` archive omits a required manifest field, package document, integrity entry, or every executable entrypoint
- **THEN** Kun SHALL reject the package before installing or executing any extension code

### Requirement: Defensive package validation
Kun MUST validate an extension in a staging area before making it available. The
validator SHALL reject archive path traversal, absolute paths, symbolic or hard
links, duplicate paths, case-folding path collisions, undeclared files, missing
files, file digest mismatches, files outside declared local resource roots,
unsupported manifest schemas, missing entrypoints, invalid identifiers, invalid
SemVer values, incompatible Kun engines, and packages that exceed published file
count, per-file size, archive size, or expanded-size limits.

#### Scenario: Archive attempts path traversal
- **WHEN** an archive member resolves outside the staging root or traverses through a link
- **THEN** Kun SHALL reject the complete archive without writing that member outside staging or retaining a partially installed version

#### Scenario: Archive contains ambiguous paths
- **WHEN** two archive entries collide after path normalization or case folding on any supported platform
- **THEN** Kun SHALL reject the package as non-portable and SHALL identify the conflicting paths

#### Scenario: Package integrity does not match
- **WHEN** any extracted file is absent from the integrity manifest or its SHA-256 digest differs from the declared digest
- **THEN** Kun SHALL reject the package before registration or entrypoint execution

#### Scenario: Package exceeds a safety limit
- **WHEN** an archive exceeds any published compressed, expanded, file-count, or per-file limit
- **THEN** Kun SHALL stop validation with a structured limit error and SHALL clean the staging data

### Requirement: Atomic versioned installation
Kun SHALL install validated packages under
`~/.kun/extensions/<publisher.name>/<version>/`, record each installed version in
the extension registry, and atomically switch the selected active version only
after validation and any required state migration succeed. A failed install SHALL
leave the previously selected version, permissions, enablement, and state usable.

Kun SHALL retain at least the immediately preceding selected version until the
user explicitly removes it so that a manual rollback remains possible.

#### Scenario: First installation succeeds
- **WHEN** package validation and permission confirmation succeed for an extension not already installed
- **THEN** Kun SHALL atomically register the exact package version and SHALL never expose the staging directory as an active extension

#### Scenario: New version installation fails
- **WHEN** validation, permission confirmation, state migration, or final activation of a newly selected version fails
- **THEN** Kun SHALL keep the prior version selected and usable and SHALL remove or quarantine the failed staging installation

#### Scenario: User selects a retained version
- **WHEN** a user explicitly requests rollback to a retained compatible package version
- **THEN** Kun SHALL apply the versioning and state-compatibility rules before atomically selecting that version

### Requirement: Registry and enablement are explicit
The extension registry SHALL persist package identity, installed versions,
selected version, source provenance, SHA-256, signature status, granted
permissions, global enabled state, and per-workspace enablement without copying a
package for each workspace. Extension-owned global data, workspace data, logs,
and account references MUST be stored outside immutable package directories and
isolated by extension identity.

#### Scenario: Workspace enablement changes
- **WHEN** a user enables or disables an installed extension for one workspace
- **THEN** Kun SHALL change activation eligibility only for that workspace and SHALL preserve the package and other workspaces' settings

#### Scenario: Package files are modified after installation
- **WHEN** an installed package no longer matches its registered integrity digest at activation time
- **THEN** Kun SHALL refuse to activate that version and SHALL report an integrity failure without deleting extension-owned data

#### Scenario: Two extensions use storage
- **WHEN** different extension identities request global or workspace storage
- **THEN** Kun SHALL resolve each request to an identity-isolated data namespace rather than either package directory

### Requirement: Installation requires informed permission consent
Kun SHALL require informed permission consent before selecting a new extension
or a version that requests additional permissions, and SHALL show the package
source, identity, version, digest,
signature status, requested permissions, and elevated risk disclosures on a
protected host-owned surface. Permission grants SHALL be bound to the exact
extension identity and requested permission set.

The disclosure MUST state that Node entrypoints and direct-DOM content scripts
are trusted-code features, that Node code runs with the current user's operating
system privileges, and that broker permissions cannot constrain direct Node
access to local resources.

#### Scenario: Unsigned local package is approved
- **WHEN** a user reviews and explicitly approves an unsigned local package and all requested permissions
- **THEN** Kun SHALL allow installation while recording its unsigned provenance and SHALL not present it as verified

#### Scenario: Upgrade adds a permission
- **WHEN** a manually selected package version requests a permission absent from the existing grant
- **THEN** Kun SHALL require fresh consent before selecting or activating the new version

#### Scenario: Consent is declined
- **WHEN** the user declines installation or any requested permission
- **THEN** Kun SHALL leave the registry's selected version and existing grants unchanged and SHALL execute no new package code

### Requirement: Supported package sources are user controlled
Kun SHALL support installation from a local `.kunx` file, explicit registration
of a local development directory, and an explicitly configured HTTPS extension
index. Every installed registry record SHALL preserve its source type and source
locator for inspection.

A development directory SHALL be validated against the same manifest and engine
contracts that are applicable without an archive, SHALL be visibly marked as a
mutable development source, SHALL not be copied or rewritten by Kun, and SHALL
reload only after an explicit developer action.

#### Scenario: Development directory is registered
- **WHEN** a developer explicitly registers a directory containing a compatible extension manifest and valid local entrypoints
- **THEN** Kun SHALL register the directory as a development source without packaging, copying, or silently reloading it

#### Scenario: Development source becomes invalid
- **WHEN** an explicit reload finds that a registered development directory no longer satisfies manifest or entrypoint validation
- **THEN** Kun SHALL reject that reload and SHALL expose an actionable validation error

### Requirement: HTTPS index format is deterministic and non-executable
A custom index using index format v1 SHALL provide extension identity and display
metadata plus an explicit version list. Each version entry SHALL provide the
exact SemVer version, HTTPS package URL, SHA-256, `engines.kun` range,
`apiVersion`, requested permission summary, and optional signature metadata.

Kun MUST treat index content as untrusted data, validate it before display or
download, and verify the downloaded package against both the selected index
entry and the package's own integrity manifest before installation. Index data
MUST never be evaluated as code.

#### Scenario: User installs an indexed version
- **WHEN** a user chooses one exact compatible version from a valid configured HTTPS index
- **THEN** Kun SHALL download only that version over HTTPS, verify its index SHA-256 and package integrity, and run the normal consent and atomic installation flow

#### Scenario: Index and package disagree
- **WHEN** a downloaded package identity, version, digest, engine range, API version, or permission set conflicts with the selected index entry
- **THEN** Kun SHALL reject the download and SHALL not register or execute it

#### Scenario: Index uses an insecure package URL
- **WHEN** an index version resolves to a non-HTTPS remote package URL
- **THEN** Kun SHALL reject that version as an invalid remote source

### Requirement: Version changes are never automatic
Kun MUST NOT poll local sources or remote indexes in the background, check for
new extension versions at application startup, automatically download or install
packages, automatically switch versions, or produce unsolicited update prompts.
Browsing or refreshing an index and selecting a version SHALL require an
explicit user action.

#### Scenario: Kun starts with indexed extensions installed
- **WHEN** Kun or the desktop application starts while configured indexes contain versions newer than installed versions
- **THEN** Kun SHALL start without contacting those indexes or changing, downloading, or prompting about any extension version

#### Scenario: User refreshes an index
- **WHEN** a user explicitly requests an index refresh
- **THEN** Kun SHALL update only the displayed catalog metadata and SHALL not download, install, or select any package until the user chooses an exact version

### Requirement: Disablement and removal are lifecycle safe
Kun SHALL stop new activations before disabling or uninstalling an extension and
SHALL coordinate deactivation of any active host before removing its registered
package version. Removing package code SHALL not implicitly delete extension
state, logs, or account references; destructive data removal MUST be a separate,
explicitly confirmed operation.

#### Scenario: Active extension is disabled
- **WHEN** a user disables an extension that has an active background host
- **THEN** Kun SHALL prevent new calls, request deactivation, enforce the host shutdown deadline, and retain installed files and extension data

#### Scenario: Installed extension is uninstalled
- **WHEN** a user confirms uninstall of the selected extension package
- **THEN** Kun SHALL deactivate it, remove its package registration and code safely, and preserve its data unless the user separately confirms data deletion

### Requirement: Existing extension-like systems remain separate
The extension package registry SHALL NOT reinterpret, migrate, or register Kun
appearance packs, MCP server configurations, or Skills as `.kunx` extensions.
Those systems SHALL continue to use their existing formats and lifecycle.

#### Scenario: Existing systems are loaded after extension support is enabled
- **WHEN** Kun starts with appearance packs, MCP servers, or Skills already configured
- **THEN** those assets SHALL retain their existing behavior and SHALL not appear as installed `.kunx` package versions
