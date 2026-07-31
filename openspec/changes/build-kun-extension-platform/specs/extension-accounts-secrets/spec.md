## ADDED Requirements

### Requirement: Providers, accounts, and bindings are separate records
Kun SHALL represent a provider definition, a user's account, and a runtime provider binding as distinct versioned records. A provider definition MUST describe transport, model capabilities, and supported authentication methods; an account MUST reference one provider and contain only non-secret identity metadata plus credential references; a binding MUST contain a coherent provider ID, account reference, and model ID.

#### Scenario: User binds a model account
- **WHEN** the user selects a model and one of several accounts for its provider
- **THEN** Kun persists the provider ID, account reference, and model ID together without copying credential material into the binding

#### Scenario: Binding references another provider's account
- **WHEN** a saved or submitted binding combines a provider with an account owned by a different provider
- **THEN** Kun rejects the binding before any model request is sent

#### Scenario: Binding references a missing account
- **WHEN** a thread, profile, or headless request resolves a deleted or unavailable account reference
- **THEN** Kun returns an account-required error and does not substitute another account automatically

### Requirement: Providers support multiple named accounts
Kun SHALL allow multiple accounts for one provider and SHALL expose only stable account IDs, provider IDs, user-assigned labels, authentication type, status, and non-secret metadata to settings and selection clients. Account status MUST distinguish at least connected, expired, interaction-required, error, and unavailable states.

#### Scenario: User adds a second account
- **WHEN** a provider already has one connected account and the user completes another supported authentication flow
- **THEN** Kun creates a distinct account reference and lets the user select either account by label

#### Scenario: Client lists accounts
- **WHEN** an authorized extension or Kun UI requests accounts for a provider
- **THEN** the response contains account references and safe metadata but no API key, access token, refresh token, client secret, or stored credential blob

#### Scenario: Account label changes
- **WHEN** a user renames an account
- **THEN** existing bindings continue resolving through the stable account reference

### Requirement: Account creation uses protected core-owned surfaces
Kun SHALL collect, display, and update account credentials only through core-owned protected surfaces that do not load extension Webviews or host DOM content scripts. The Account Broker MUST bind every account operation to the requesting extension identity and declared permission rather than trusting a caller-supplied extension ID.

#### Scenario: Extension requests account creation
- **WHEN** an authorized extension asks the Account Broker to create an account
- **THEN** Kun opens a protected core flow for the provider's declared authentication method and returns only the resulting account reference

#### Scenario: Webview submits raw credentials
- **WHEN** an extension Webview attempts to write a secret directly through a generic message or settings API
- **THEN** Kun rejects the request and does not persist the submitted value

#### Scenario: Content script targets an account dialog
- **WHEN** an extension has direct-DOM permission and an account or credential dialog is open
- **THEN** Kun keeps the protected surface outside content-script injection scope

### Requirement: API key authentication stores only credential references in configuration
Kun SHALL support API-key accounts while storing the API key in the protected Credential Store. Application settings, extension state, thread data, provider bindings, logs, and IPC responses MUST contain only an opaque credential or account reference.

#### Scenario: API key account is created
- **WHEN** the user enters and confirms an API key in the protected account flow
- **THEN** Kun validates or stores the secret through the Credential Store and persists only the resulting account reference outside that store

#### Scenario: API key is replaced
- **WHEN** the user updates an existing API-key account
- **THEN** Kun atomically replaces its credential, keeps the stable account reference, and invalidates in-memory copies of the prior key

#### Scenario: API key validation fails
- **WHEN** provider probing rejects a newly entered API key
- **THEN** Kun reports the provider error without placing the rejected key in settings, logs, telemetry, or extension-visible state

### Requirement: OAuth authorization uses verifiable core-managed flows
Kun SHALL support OAuth 2.0 authorization-code flows with PKCE for providers that declare them. The Account Broker MUST generate and validate state and PKCE values, MUST restrict callbacks to the initiating transaction, MUST exchange and store tokens outside extension UI, and MUST reject unsolicited, replayed, expired, or mismatched callbacks.

#### Scenario: OAuth authorization succeeds
- **WHEN** the user completes a provider's authorization-code flow and the callback has the expected state and PKCE verifier
- **THEN** Kun exchanges the code, stores access and refresh credentials in protected storage, and returns a connected account reference

#### Scenario: OAuth callback state is invalid
- **WHEN** a callback has missing, mismatched, replayed, or expired state
- **THEN** Kun rejects the callback, stores no account credentials, and records a redacted security diagnostic

#### Scenario: User cancels OAuth authorization
- **WHEN** the user closes or denies the authorization flow before completion
- **THEN** Kun terminates the pending transaction and returns a cancelled result without creating an account

### Requirement: Device authorization is bounded and cancellable
Kun SHALL support OAuth device authorization for providers that declare a device endpoint and token endpoint. The Account Broker MUST display the verification URL and user code in a protected surface, honor the server-provided polling interval and expiry, support cancellation, and store successful credentials through the same protected account path.

#### Scenario: Device authorization succeeds
- **WHEN** the user approves a valid device code before expiry
- **THEN** Kun stops polling, stores the returned credentials, and creates a connected account reference

#### Scenario: Authorization remains pending
- **WHEN** the device token endpoint reports authorization pending or slow-down
- **THEN** Kun continues polling no faster than the effective provider interval and keeps one bounded pending transaction

#### Scenario: Device flow expires or is cancelled
- **WHEN** the device code expires or the user cancels the transaction
- **THEN** Kun stops polling, clears transient codes, creates no account, and returns the corresponding terminal status

### Requirement: Token refresh is serialized and failure-aware
Kun SHALL refresh expiring OAuth credentials through the Account Broker, SHALL serialize concurrent refresh attempts per account, and SHALL atomically replace stored tokens. A terminal refresh failure MUST mark the account interaction-required or expired and MUST NOT expose the refresh token to the provider UI.

#### Scenario: Concurrent requests need refresh
- **WHEN** multiple model or authenticated-fetch requests encounter the same nearly expired account
- **THEN** Kun performs one refresh operation and lets all valid waiters use the resulting credential

#### Scenario: Refresh token is rejected
- **WHEN** the provider rejects the stored refresh token as invalid or revoked
- **THEN** Kun marks the account interaction-required, fails dependent requests explicitly, and does not fall back to another account

#### Scenario: Refreshed credential persistence fails
- **WHEN** a refresh succeeds upstream but Kun cannot commit the new credentials securely
- **THEN** Kun fails closed, does not persist a partially updated credential set, and reports a protected-storage error

### Requirement: Credential storage is protected and reports degradation
Kun SHALL use an operating-system-backed credential facility when available and SHALL use an authenticated encrypted fallback only when the primary facility is unavailable. The Credential Store MUST record its protection mode, MUST bind ciphertext to the local Kun profile, MUST avoid plaintext-at-rest fallback, and MUST expose a non-secret degraded-protection status to the user and diagnostics.

#### Scenario: Operating-system credential storage is available
- **WHEN** Kun creates or updates an account on a supported system with credential storage available
- **THEN** the secret is stored through that facility and only an opaque reference is written to ordinary data files

#### Scenario: Primary credential storage is unavailable
- **WHEN** Kun cannot use the operating-system credential facility but can initialize the encrypted fallback
- **THEN** Kun stores the secret in the fallback, marks protection as degraded, and clearly reports that state without revealing the secret

#### Scenario: No protected storage can be initialized
- **WHEN** neither primary nor encrypted fallback storage is available
- **THEN** Kun refuses to save new credentials and preserves existing settings and account references unchanged

### Requirement: Brokered authentication minimizes secret exposure
Kun SHALL provide account discovery, session creation and deletion, and authenticated network requests through the Account Broker. By default the Broker MUST inject authentication after extension request validation so extensions receive an account handle rather than credential bytes.

#### Scenario: Extension performs authenticated fetch
- **WHEN** an extension with permission to use a provider account sends an allowed request through authenticated fetch
- **THEN** the Broker refreshes credentials if needed, injects provider authentication, performs the request, and returns a response that excludes credential headers

#### Scenario: Extension lacks account permission
- **WHEN** an extension requests an account operation for a provider outside its granted account permissions
- **THEN** the Broker denies the operation before reading or injecting any credential

#### Scenario: Request attempts to override authorization
- **WHEN** an extension supplies an authorization header or credential field that conflicts with Broker-managed authentication
- **THEN** the Broker rejects or removes the untrusted credential field according to the provider definition and never combines it with the stored secret

### Requirement: Direct secret access is exceptional and auditable
Kun SHALL expose raw secret access only to a Node extension that declares the dedicated secret-read permission and receives explicit user approval for that provider. Webviews and content scripts MUST never receive raw account secrets, and every successful or denied secret-read attempt MUST produce a redacted audit event.

#### Scenario: Custom signer needs a secret
- **WHEN** an approved Node provider adapter with secret-read permission requests its bound account secret for a documented custom-signing operation
- **THEN** Kun returns the minimum scoped secret to that host process and records extension, provider, account, operation, and outcome without recording the value

#### Scenario: Webview requests a secret
- **WHEN** a Webview, content script, or Node extension without the dedicated permission requests raw credential material
- **THEN** Kun denies the request and records a redacted audit event

#### Scenario: Extension update adds secret access
- **WHEN** a new extension version adds the secret-read permission
- **THEN** Kun keeps that version disabled until the user separately accepts the elevated disclosure

### Requirement: Account use is isolated by extension and provider ownership
The Account Broker SHALL derive the caller identity from its host channel and SHALL enforce provider ownership and granted account scopes for every operation. An extension MUST NOT enumerate or use another extension's private provider accounts unless a core-defined shared provider permission explicitly authorizes that provider.

#### Scenario: Extension spoofs another extension ID
- **WHEN** an extension includes another extension's ID or account reference in an account request
- **THEN** Kun evaluates the request under the authenticated host identity and denies access outside its effective scopes

#### Scenario: Account belongs to an uninstalled provider
- **WHEN** a provider-owning extension is disabled or uninstalled
- **THEN** Kun marks its accounts unavailable and bindings unresolved without automatically deleting stored credentials

#### Scenario: User deletes an account
- **WHEN** the user explicitly deletes an account after confirming the affected bindings
- **THEN** Kun deletes its stored credentials, invalidates active sessions, and leaves dependents in an explicit account-required state

### Requirement: Legacy plaintext model credentials migrate non-destructively
Kun SHALL migrate existing model-provider API keys and equivalent Kun runtime credential overrides into protected account records and replace their ordinary-settings values with account references. Migration MUST be idempotent, MUST preserve the provider/model association, MUST commit the protected secret before removing plaintext, and MUST retain legacy read compatibility for one migration cycle.

#### Scenario: Legacy provider has an API key
- **WHEN** settings normalization finds a supported provider profile with a non-empty legacy API key and no completed migration record
- **THEN** Kun creates or reuses a deterministic account for that provider, stores the key securely, rewrites bindings to its account reference, and removes the plaintext from newly saved settings

#### Scenario: Duplicate migration is attempted
- **WHEN** Kun starts again after the same legacy credential was already migrated successfully
- **THEN** migration reuses the recorded account and does not create duplicate accounts or overwrite a newer credential

#### Scenario: Secure migration commit fails
- **WHEN** the Credential Store cannot commit a legacy key or the account/settings transaction cannot complete
- **THEN** Kun preserves the original readable settings, records no completed migration marker, and reports a recoverable migration error

#### Scenario: Legacy runtime override differs from provider account
- **WHEN** a legacy Kun runtime override and its selected provider profile contain different non-empty credentials
- **THEN** Kun preserves both as distinct labeled accounts or bindings rather than silently discarding either secret

### Requirement: Secret handling is redacted end to end
Kun SHALL redact known secrets and authentication artifacts from logs, diagnostics, telemetry, errors, crash reports, event streams, clipboard operations, and persisted extension messages. Secret comparisons and redaction MUST cover API keys, access and refresh tokens, OAuth codes, device codes, client secrets, cookies, and authorization headers.

#### Scenario: Provider returns credential-bearing error details
- **WHEN** an authentication endpoint or extension includes a known secret in an error, header, or response summary
- **THEN** Kun removes or masks the value before the data crosses a logging, event, telemetry, or UI boundary

#### Scenario: Extension host crashes after secret access
- **WHEN** a permitted Node extension terminates while holding credential material
- **THEN** Kun invalidates its in-memory broker session, records only redacted crash context, and never writes the secret into the crash report

### Requirement: Headless account use never depends on UI
Stored valid accounts SHALL be usable by extension providers and authenticated fetch when Kun runs without Electron. Any login, consent, reauthentication, or secret-unlock step that requires user interaction MUST return a structured interaction-required result with an actionable continuation path rather than hanging or launching an implicit GUI.

#### Scenario: Headless request uses a valid stored account
- **WHEN** `kun serve`, a scheduled task, or CLI Agent run selects a connected account while the desktop GUI is closed
- **THEN** the Account Broker resolves or refreshes that account and completes the authorized request without renderer involvement

#### Scenario: Headless request needs login
- **WHEN** no valid credential exists or protected storage requires user interaction
- **THEN** Kun fails the request with a stable interaction-required code and leaves provider/model routing unchanged
