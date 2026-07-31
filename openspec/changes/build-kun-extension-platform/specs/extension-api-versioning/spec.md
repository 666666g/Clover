## ADDED Requirements

### Requirement: Version dimensions are independent and explicit
Every extension SHALL identify its package with a SemVer extension version and
SHALL declare `manifestVersion`, a SemVer `apiVersion`, an `engines.kun` SemVer
range, and an integer `stateSchemaVersion`. The Kun-to-host connection SHALL also
negotiate an internal `rpcVersion` independently of those public declarations.

Changing one version dimension MUST NOT implicitly change another. Kun SHALL
report compatibility failures using the failing dimension, declared value, and
supported value or range.

#### Scenario: Package has independently compatible versions
- **WHEN** an extension's package version, manifest version, API version, Kun engine range, state schema, and host RPC version are each supported
- **THEN** Kun SHALL admit the package to the next validation stage without deriving one version from another

#### Scenario: One dimension is incompatible
- **WHEN** an extension passes package SemVer validation but declares an unsupported manifest version or Extension API major
- **THEN** Kun SHALL reject activation with a structured error naming that incompatible dimension rather than treating the package version as API compatibility

### Requirement: Published Extension APIs follow SemVer
Kun SHALL version every published Extension API according to SemVer. All symbols
and behaviors published through official Extension API packages and host
contracts SHALL be stable APIs from their first release. Patch releases
MUST preserve public types and behavior, minor releases SHALL add only backwards-
compatible optional capabilities, and breaking changes SHALL require a new API
major version. Kun SHALL NOT publish an `experimental` namespace as a way to
bypass this compatibility contract.

#### Scenario: Host adds an optional minor capability
- **WHEN** Kun adds an optional API method or event in a minor API release
- **THEN** an extension targeting an earlier minor release of the same major SHALL continue to activate and run without modification

#### Scenario: Public contract requires a breaking change
- **WHEN** a public type, method, event, permission meaning, or required behavior cannot remain backwards compatible
- **THEN** the change SHALL ship under a new Extension API major rather than replacing the existing contract in a minor or patch release

### Requirement: Kun supports current and previous API majors
For current Extension API major `N`, Kun SHALL execute extensions targeting
majors `N` and `N-1` when `N` is greater than 1. API major 1 SHALL support major 1.
Extensions targeting a future major or a major older than the previous supported
major SHALL be rejected before any Node entrypoint, Webview code, or host content
script executes.

Compatibility support SHALL include the public SDK behavior and host adaptation
needed by the older major, not merely acceptance of its manifest.

#### Scenario: Current and previous majors coexist
- **WHEN** current-major and previous-major extensions are enabled together and satisfy their other compatibility constraints
- **THEN** Kun SHALL activate both through their respective supported API contracts in the same installation

#### Scenario: Extension targets a removed major
- **WHEN** an extension targets API major `N-2` after Kun has made `N` current
- **THEN** Kun SHALL refuse activation before executing extension code and SHALL identify the newest Kun release line that still supports the extension when that metadata is available

#### Scenario: Extension targets a future major
- **WHEN** an extension declares an API major newer than Kun supports
- **THEN** Kun SHALL refuse activation before executing extension code and SHALL report the supported API majors

### Requirement: Engine and manifest compatibility are checked before execution
Kun SHALL validate `engines.kun`, `manifestVersion`, and the selected package
version before negotiating an Extension API or loading any extension-controlled
code or remote content. It SHALL not guess compatibility, coerce an unsupported
range, or silently load a different installed version unless the user explicitly
selected that version under package-management rules.

#### Scenario: Kun engine is outside the declared range
- **WHEN** the running Kun version does not satisfy an extension's `engines.kun` range
- **THEN** Kun SHALL keep the extension inactive and SHALL show the declared range and running version without executing an entrypoint

#### Scenario: Manifest schema is unknown
- **WHEN** a package declares a `manifestVersion` unsupported by the running Kun version
- **THEN** Kun SHALL reject the manifest rather than ignoring fields whose lifecycle or security meaning is unknown

### Requirement: Capability negotiation is fail-closed
After base version admission, Kun and the extension host SHALL negotiate the
available API minor capabilities and internal RPC protocol before activation.
Optional capabilities absent from the negotiated API SHALL be reported as
unsupported, while required capabilities absent from the negotiated API SHALL
block activation. Extension payloads SHALL NOT be able to upgrade their negotiated
version or grants after the connection is established.

#### Scenario: Optional capability is unavailable
- **WHEN** an extension checks or invokes an optional API capability not present in the negotiated minor version
- **THEN** the host SHALL expose it as unavailable or return a structured unsupported-capability error without destabilizing activation

#### Scenario: Required capability is unavailable
- **WHEN** a manifest-declared contribution requires a capability missing from the negotiated API contract
- **THEN** Kun SHALL reject activation before registering that contribution and SHALL name the missing capability

#### Scenario: RPC negotiation fails
- **WHEN** Kun and its child host cannot agree on an internal `rpcVersion`
- **THEN** Kun SHALL execute no extension entrypoint, mark the host bridge incompatible, and report an actionable installation or runtime error

### Requirement: Internal RPC is not a public extension contract
The `rpcVersion` and its wire format SHALL be private implementation details
between a Kun release and the host runtime shipped with that release. Third-party
extensions MUST use the official SDK and Host Context and SHALL receive no
compatibility promise for importing or speaking the internal RPC directly.

#### Scenario: Extension attempts direct RPC access
- **WHEN** third-party code sends an undeclared internal RPC method instead of using its negotiated Host Context
- **THEN** Kun SHALL reject the method as unsupported and SHALL not treat it as a public API compatibility defect

### Requirement: Deprecation spans a complete API-major transition
Before removing or breaking a published API, Kun SHALL mark it deprecated,
document its supported replacement, emit validation and development-time
warnings that identify the affected extension usage, and retain it for at least
one complete Extension API major version. Removal SHALL occur only in a later API
major after that transition period.

#### Scenario: Extension uses a deprecated API
- **WHEN** validation or development activation detects use of a deprecated public capability
- **THEN** Kun SHALL keep the capability functional within its support window and SHALL report the replacement and planned removal major

#### Scenario: Deprecation window has not elapsed
- **WHEN** a Kun release is still within the required full-major support transition
- **THEN** Kun SHALL not remove or change the deprecated capability incompatibly

### Requirement: State schema upgrades are transactional
Kun SHALL perform extension state schema upgrades transactionally. Before
activating a selected extension version whose `stateSchemaVersion` is higher than
the committed extension state, Kun SHALL create a recoverable backup
and invoke the extension's declared `migrateState(from, to)` path for every
affected global and workspace state namespace. Kun SHALL expose migration through
the stable lifecycle API and SHALL atomically commit migrated state only after
all required migration work succeeds.

The old selected package and old committed state SHALL remain usable until the
new package, migration, and activation admission succeed.

#### Scenario: State migration succeeds
- **WHEN** a manually selected extension version declares a higher state schema and all required migration steps complete successfully
- **THEN** Kun SHALL atomically commit the new state schema and state data before selecting the new version for normal activation

#### Scenario: State migration fails
- **WHEN** migration throws, times out, returns invalid state, or cannot atomically commit every affected namespace
- **THEN** Kun SHALL restore or retain the prior committed state, keep the prior version selected and usable, and report the failed from/to schema versions

#### Scenario: Extension has multiple workspace namespaces
- **WHEN** an upgrade requires migration of global state and state for multiple workspaces
- **THEN** Kun SHALL not expose a mixed committed schema in which only a subset of required namespaces was migrated

### Requirement: State downgrades are never inferred
Kun MUST NOT call upgrade migrations in reverse, infer a reverse transformation,
or expose newer-schema state to code that declares only an older schema. A manual
package rollback SHALL activate only with a compatible retained state snapshot or
an explicit forward-compatible state declaration; otherwise Kun SHALL refuse the
rollback without altering the current package or state.

#### Scenario: Matching pre-upgrade snapshot exists
- **WHEN** a user requests manual rollback and Kun has a valid retained state snapshot for that package's schema
- **THEN** Kun SHALL restore that snapshot atomically before selecting the retained package version

#### Scenario: No compatible rollback state exists
- **WHEN** a user requests a package downgrade but only newer incompatible state is available
- **THEN** Kun SHALL refuse activation of the older version and SHALL leave the current version and state unchanged rather than attempting reverse migration

### Requirement: Interrupted migrations are recoverable
Migration backups and commit markers SHALL allow Kun to distinguish old committed
state, fully migrated state, and incomplete migration work after a crash or power
loss. On recovery, Kun SHALL choose a complete committed state and SHALL never
activate an extension against partial migration output.

#### Scenario: Kun stops during migration
- **WHEN** the process exits after migration starts but before the atomic commit completes
- **THEN** the next startup SHALL discard or quarantine incomplete output, retain or restore the prior committed state, and keep the prior package selected

#### Scenario: Kun stops after commit
- **WHEN** the process exits after the new state commit and selected-version switch are durably complete
- **THEN** the next startup SHALL recognize the new state and package as committed without rerunning completed migrations

### Requirement: Raw host DOM is outside compatibility guarantees
Kun SHALL exclude raw host DOM from its Extension API compatibility guarantees.
Host DOM structure, element selectors, CSS class names, React component details,
and isolated-world `hostContentScripts` SHALL NOT be part of the stable Extension
API or current-plus-previous-major guarantee unless a specific behavior is also
published through an official SDK contract. Kun SHALL label direct-DOM access as
high risk in manifests, validation, documentation, and installation consent.

Kun SHALL be permitted to change raw host DOM in a minor or patch release without
compatibility adapters. Such changes MUST NOT break the separately documented stable Webview,
message, command, contribution, Agent, tool, account, or Provider APIs.

#### Scenario: Extension depends on a raw selector
- **WHEN** a Kun update changes an undocumented host element or CSS selector used by a content script
- **THEN** the resulting content-script incompatibility SHALL be treated as an unsupported DOM dependency rather than a breach of the stable Extension API contract

#### Scenario: Stable SDK behavior has a DOM-backed implementation
- **WHEN** Kun changes its internal DOM while an extension uses only a documented SDK contribution or Webview contract
- **THEN** Kun SHALL preserve that documented behavior for the supported API majors without requiring the extension to know the new DOM structure

### Requirement: Compatibility is release-gated and observable
Kun SHALL maintain automated compatibility fixtures for the current and previous
Extension API majors, representative manifest versions, RPC negotiation, state
migration recovery, and incompatibility rejection. Extension validation and
runtime diagnostics SHALL expose the negotiated API major/minor, manifest
version, engine result, RPC result, and committed state schema without exposing
secrets.

#### Scenario: Kun release is validated
- **WHEN** CI evaluates a release that changes the Extension API, manifest parser, host bridge, or state store
- **THEN** fixtures for both supported API majors and migration recovery SHALL pass before the release is accepted

#### Scenario: Developer diagnoses compatibility
- **WHEN** an extension fails admission or activates through the previous API major
- **THEN** diagnostics SHALL identify each declared and negotiated version dimension and SHALL provide the applicable incompatibility or deprecation guidance
