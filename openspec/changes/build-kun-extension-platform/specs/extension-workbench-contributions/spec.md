## ADDED Requirements

### Requirement: Typed namespaced workbench contribution registry
The workbench SHALL resolve built-in and extension-provided surfaces through one typed contribution registry. Built-in contribution IDs SHALL use the `builtin:<id>` namespace, extension contribution IDs SHALL use `extension:<extension-id>/<local-id>`, and duplicate or malformed IDs SHALL be rejected without replacing an existing contribution.

#### Scenario: Extension contributes a right sidebar view
- **WHEN** an enabled extension with ID `acme.issues` declares a right sidebar view with local ID `issues`
- **THEN** the registry SHALL expose it as `extension:acme.issues/issues` without changing any built-in view identity

#### Scenario: Two contributions resolve to the same identity
- **WHEN** an extension manifest contains duplicate local IDs or attempts to use a built-in namespace
- **THEN** validation SHALL reject the conflicting contributions and SHALL NOT replace the previously registered surface

### Requirement: Controlled workbench contribution points
The public manifest SHALL support controlled contributions for activity and sidebar containers, left and right sidebar views, auxiliary panels, editor tabs and full-page views, top-bar and Composer actions, message actions and result previews, settings sections, context menus, commands, and notifications. The host SHALL reject unknown contribution-point kinds instead of mounting arbitrary extension components into the Kun React tree.

#### Scenario: Manifest declares supported workbench surfaces
- **WHEN** an extension declares valid contributions across multiple supported workbench locations
- **THEN** the host SHALL validate and register each contribution using the contract for its declared location

#### Scenario: Manifest declares an unknown surface
- **WHEN** an extension declares a contribution-point kind not defined by its negotiated Extension API version
- **THEN** manifest validation SHALL report the unsupported kind and SHALL NOT mount it as an untyped fallback

### Requirement: Static discovery and lazy activation
The workbench SHALL discover contribution metadata without executing extension code and SHALL activate an extension only when a matching activation event occurs. Opening an extension view or invoking an extension command SHALL activate the owning extension before dispatch, while merely rendering its icon or title SHALL NOT activate it.

#### Scenario: Workbench renders an unopened extension view
- **WHEN** the workbench builds its sidebar from an enabled extension manifest and the view has not been opened
- **THEN** the declared icon and title SHALL be rendered without executing the extension entry point

#### Scenario: User opens a lazily activated view
- **WHEN** the user opens a registered extension view whose activation event matches that view
- **THEN** the host SHALL activate the owning extension before establishing the view session

### Requirement: Context-based visibility uses a closed expression language
Contribution visibility and enablement SHALL be evaluated from a documented, side-effect-free `when` expression language over host-provided context keys. The evaluator SHALL NOT execute JavaScript, read arbitrary renderer globals, or grant a capability that the extension lacks.

#### Scenario: Workspace context changes
- **WHEN** a contribution's `when` expression becomes false after the active workspace or workbench mode changes
- **THEN** the host SHALL hide or disable the contribution and SHALL dispose any view session whose contract requires closure

#### Scenario: Expression references an unavailable capability
- **WHEN** a `when` expression references a context key or permission not available in the negotiated API
- **THEN** the evaluator SHALL resolve it as unavailable and SHALL NOT execute extension-supplied code

### Requirement: Enablement, trust, and permission gating
The registry SHALL expose a contribution only when its extension is enabled for the current workspace, compatible with the running Kun version, allowed by workspace trust, and granted every permission required by that contribution. Revoking any required grant SHALL prevent new invocations immediately.

#### Scenario: Extension is disabled in one workspace
- **WHEN** an extension is globally installed but disabled for the active workspace
- **THEN** its workbench contributions SHALL be absent in that workspace while remaining available in workspaces where it is enabled

#### Scenario: Permission is revoked while an action is visible
- **WHEN** the user revokes a permission required by a registered action
- **THEN** the host SHALL remove or disable the action and SHALL reject a concurrent stale invocation at the broker boundary

### Requirement: Deterministic ordering and placement
The host SHALL order contributions deterministically from host-defined location groups, declared ordering metadata, and fully qualified contribution IDs. Extensions SHALL NOT place content in undeclared host coordinates or force themselves ahead of protected built-in controls.

#### Scenario: Multiple extensions target one action group
- **WHEN** several enabled extensions contribute actions with equal declared priority to the same supported group
- **THEN** the host SHALL render them in a stable order derived from their fully qualified IDs

### Requirement: Resilient layout persistence
Workbench layout state SHALL persist only stable fully qualified contribution IDs and host-owned layout metadata. Missing, disabled, upgraded, or uninstalled contributions SHALL be ignored safely, and uninstalling an extension SHALL remove its stale layout references without corrupting built-in layout state.

#### Scenario: Persisted view no longer exists after an update
- **WHEN** a saved layout references an extension view removed by a newly installed extension version
- **THEN** the workbench SHALL fall back to a valid host view and SHALL preserve unrelated layout selections

#### Scenario: Extension is uninstalled
- **WHEN** the user uninstalls an extension with open panels and saved placement state
- **THEN** the host SHALL close its sessions, remove its layout references, and retain all built-in and other-extension layout state

### Requirement: Host-rendered declarative controls
Commands, menu items, small actions, settings fields, badges, and notifications SHALL be rendered by Kun from validated declarative metadata. The host SHALL own focus behavior, accessibility semantics, confirmation affordances, text truncation, and disabled state, and SHALL NOT execute an extension-supplied React component for those controls.

#### Scenario: Extension contributes a Composer action
- **WHEN** a valid Composer action becomes visible
- **THEN** Kun SHALL render the action using a host component and dispatch only its namespaced command plus the documented invocation context

#### Scenario: Declarative label contains markup
- **WHEN** a contribution supplies HTML or script-like text in a label, description, or notification body
- **THEN** the host SHALL render it as sanitized text or reject it according to the field schema

### Requirement: Namespaced command dispatch
Extension commands SHALL have identities derived from the owning extension ID and a manifest-declared local command ID. Command arguments and results SHALL be schema validated, dispatch SHALL use the authenticated extension principal, and menu or action contributions SHALL reference only commands visible to the same extension or documented public host commands.

#### Scenario: Host invokes an extension command
- **WHEN** a user activates a registered extension action
- **THEN** the command broker SHALL activate the owner, validate the invocation payload, and dispatch the command with host-derived workspace and surface context

#### Scenario: Extension references another extension's private command
- **WHEN** a manifest action references a command owned by a different extension without a documented public command contract
- **THEN** manifest validation SHALL reject the reference

### Requirement: Complex extension UI uses isolated Webviews
Every complex extension-provided workbench view SHALL run in a host-created Webview outside the Kun React component tree. The host SHALL create a distinct view session bound to the extension ID, extension version, contribution ID, workspace, WebContents identity, and an unguessable session nonce.

#### Scenario: User opens two instances of one extension view
- **WHEN** the contribution contract permits two instances of the same view
- **THEN** the host SHALL create two independently identified sessions while binding both to the same authenticated extension principal

#### Scenario: Webview requests a different contribution identity
- **WHEN** a guest attempts to send a message using a contribution ID or session nonce other than the values bound by the host
- **THEN** the bridge SHALL reject the message without dispatching it to Kun or the extension host

### Requirement: Extension resources use a confined custom protocol
Webview documents and local assets SHALL load through `kun-extension://<extension-id>/...`. The protocol handler SHALL canonicalize each request, bind it to the installed extension version and declared local resource roots, and reject traversal, symbolic-link escape, undeclared files, cross-extension access, and remote redirects.

#### Scenario: Webview loads a packaged asset
- **WHEN** a view requests a file inside its declared resource root through its own extension origin
- **THEN** the protocol handler SHALL return that installed-version asset with a safe content type

#### Scenario: Webview attempts path traversal
- **WHEN** a guest requests a path that normalizes outside its declared extension resource roots
- **THEN** the protocol handler SHALL reject the request without disclosing whether the target exists

### Requirement: Webview sandbox baseline is mandatory
Every extension Webview SHALL use the Kun-owned preload with `nodeIntegration` disabled, `contextIsolation` enabled, and Chromium sandboxing enabled. An extension SHALL NOT choose a different preload or WebPreferences and SHALL NOT receive Electron modules, Node globals, the complete `window.kunGui` bridge, Kun runtime credentials, account secrets, or Extension Host IPC handles.

#### Scenario: Extension declares unsafe WebPreferences
- **WHEN** an extension document or manifest requests Node integration, a custom preload, disabled sandboxing, or disabled context isolation
- **THEN** the host SHALL ignore or reject the unsafe request and SHALL NOT attach the Webview with those preferences

#### Scenario: Guest inspects its global bridge
- **WHEN** extension UI enumerates the APIs exposed in its isolated page
- **THEN** it SHALL see only the versioned extension-view bridge granted to that session and SHALL NOT see `window.kunGui`

### Requirement: Webview storage and session isolation
Webview sessions SHALL NOT be shared across different extension IDs and SHALL be non-persistent by default. Durable global or workspace data SHALL use the quota-controlled Extension Storage API so that clearing or recreating a Webview cannot expose another extension's state.

#### Scenario: Two extensions use identical storage keys
- **WHEN** two extension Webviews write the same browser-storage key
- **THEN** neither guest SHALL be able to read the other extension's stored value

#### Scenario: View needs durable state
- **WHEN** extension UI stores state through the documented view or extension storage API and the view is recreated
- **THEN** the host SHALL restore only data scoped to the same extension, contribution, and applicable workspace

### Requirement: Content Security Policy and brokered network access
Extension Webviews SHALL enforce a host-approved Content Security Policy that blocks remote script execution, unsafe navigation, and direct network connections by default, including `connect-src 'none'`. Network access SHALL use the authenticated Kun network broker and SHALL be limited to granted, manifest-declared destinations.

#### Scenario: Webview performs a direct remote fetch
- **WHEN** extension UI calls browser `fetch`, WebSocket, or another direct connection to a remote origin
- **THEN** the Webview policy SHALL block the connection regardless of a broker network grant

#### Scenario: Webview uses the network broker
- **WHEN** extension UI requests an HTTPS destination covered by its active network grant through the broker
- **THEN** the broker SHALL validate the extension principal and destination before issuing the request and returning a bounded response

### Requirement: Navigation, popup, download, and device access are denied by default
The Webview host SHALL prevent guest navigation away from its extension origin, creation of unapproved windows, arbitrary downloads, and camera, microphone, geolocation, MIDI, USB, serial, Bluetooth, screen-capture, and notification permissions. Any supported external-open or file-export action SHALL be mediated by a documented host command and its applicable permission or consent flow.

#### Scenario: Guest attempts to open a popup
- **WHEN** extension UI calls `window.open` or navigates its top frame to an external URL
- **THEN** the host SHALL deny the popup or navigation and SHALL NOT create a privileged BrowserWindow

#### Scenario: Guest requests a device permission
- **WHEN** an extension Webview requests a Chromium device or media permission
- **THEN** the session permission handler SHALL deny it unless a future public API explicitly defines and grants that capability

### Requirement: Narrow authenticated view messaging
The view bridge SHALL expose only versioned request, event, theme, locale, and state methods documented by the public Extension API. The main process SHALL derive the extension principal from the bound WebContents session rather than request fields and SHALL validate method name, contribution ID, payload schema, payload size, call rate, and lifecycle state before routing a message.

#### Scenario: Guest forges an extension ID in a request body
- **WHEN** a Webview submits a valid method payload containing another installed extension's ID
- **THEN** the broker SHALL ignore the claimed identity, enforce the sender-bound principal, and reject any resulting cross-extension access

#### Scenario: Guest floods oversized messages
- **WHEN** a Webview exceeds the documented message-size, rate, or outstanding-request limit
- **THEN** the bridge SHALL reject or throttle calls without growing an unbounded renderer or main-process queue

### Requirement: View state is scoped and non-secret
The view state API SHALL store schema-versioned, quota-bounded structured data scoped to the authenticated extension, contribution, and workspace where applicable. View state SHALL NOT be a credential store, and the host SHALL reject secret-bearing or unsupported binary payloads according to the public schema.

#### Scenario: View restores workspace state
- **WHEN** a workspace-scoped extension view is reopened in the same workspace
- **THEN** the host SHALL return its last committed compatible state without exposing global or other-workspace state

### Requirement: Theme, locale, focus, and accessibility integration
The host SHALL provide extension views with documented theme tokens, locale, zoom, and accessibility preferences without exposing host DOM or private CSS variables. View containers SHALL have host-owned accessible names and focus boundaries, and declarative controls SHALL participate in normal keyboard navigation and focus restoration.

#### Scenario: Kun changes theme while a view is open
- **WHEN** the user switches between supported Kun themes
- **THEN** the view bridge SHALL deliver the updated public theme token set and the container SHALL remain readable and keyboard reachable

#### Scenario: Extension view closes from the keyboard
- **WHEN** a keyboard user closes an extension panel and no extension element remains focused
- **THEN** the host SHALL restore focus to the documented originating workbench control

### Requirement: Webview failure and teardown are contained
Closing a view, disabling or uninstalling its extension, changing workspaces, or terminating its guest process SHALL dispose the view session, pending bridge calls, event subscriptions, and host-owned resources. A failed Webview SHALL produce an extension-scoped error placeholder or close safely and SHALL NOT crash the main workbench renderer.

#### Scenario: Extension Webview process crashes
- **WHEN** Chromium reports that an extension guest process exited unexpectedly
- **THEN** Kun SHALL dispose the invalid session and show a bounded recovery action without affecting other views

#### Scenario: Extension is disabled with a view open
- **WHEN** the extension is disabled for the current workspace
- **THEN** all of its active view sessions SHALL close and subsequent messages from stale guests SHALL be rejected

### Requirement: Direct host DOM access requires an explicit high-risk declaration
Direct host DOM behavior SHALL be declared statically as `hostContentScripts` with packaged script and style resources, supported host-surface targets, and activation conditions. Installation and permission review SHALL classify this capability as high risk, and the host SHALL inject no content script until the user has explicitly granted the corresponding permission for that extension version and workspace policy.

#### Scenario: Extension declares a host content script
- **WHEN** a user reviews an extension version containing `hostContentScripts`
- **THEN** the protected permission surface SHALL explain that the extension can read and modify visible Kun workbench content before consent is accepted

#### Scenario: Extension dynamically requests an undeclared script
- **WHEN** extension code asks the host to inject a script or stylesheet not present in its validated manifest and package
- **THEN** the host SHALL reject the request

### Requirement: Host content scripts run in an isolated world
Every permitted host content script SHALL execute in an Electron isolated world assigned to its extension and SHALL NOT execute in the renderer main world. It SHALL NOT receive Node globals, Electron modules, `window.kunGui`, React internals, runtime credentials, or another extension's isolated-world bridge; any supported communication SHALL use a narrower sender-bound content-script bridge.

#### Scenario: Content script reads host page content
- **WHEN** a granted content script queries or modifies visible workbench DOM on a declared surface
- **THEN** the mutation SHALL occur from its isolated world without making main-world JavaScript objects directly available

#### Scenario: Content script attempts to call the preload bridge
- **WHEN** content-script code accesses `window.kunGui` or a main-world object reference
- **THEN** the isolated-world environment SHALL not provide that privileged object or reference

### Requirement: Raw host DOM is outside the compatibility contract
Host element structure, selectors, CSS classes, React ownership, and visual layout used by `hostContentScripts` SHALL be explicitly unsupported Extension API. Kun releases SHALL NOT promise SemVer compatibility for raw DOM hooks, and failure of a content script after a host UI change SHALL be contained without preventing Kun startup or normal workbench operation.

#### Scenario: Kun update changes a private DOM selector
- **WHEN** an installed content script no longer finds a private selector after a compatible Kun update
- **THEN** Kun SHALL continue operating, record an extension-scoped failure, and SHALL NOT treat the private selector as an API regression

### Requirement: Content-script lifecycle is bounded
The host SHALL associate injected scripts, styles, event subscriptions, and extension-marked DOM roots with the extension and target surface. On disablement, uninstall, workspace deactivation, or permission revocation, it SHALL send deactivation, remove host-managed resources, and reload the affected host surface when safe cleanup cannot otherwise be guaranteed.

#### Scenario: DOM permission is revoked
- **WHEN** the user revokes the direct DOM permission while the script is active
- **THEN** the host SHALL stop subsequent bridge calls, remove host-managed styles and roots, and restore a clean surface before accepting further privileged input

### Requirement: Protected consent surfaces exclude extension content
Extension installation and update review, permission grants, workspace trust, account and secret entry, secret disclosure, external-side-effect approvals, and other security-critical consent SHALL be presented in host-controlled protected surfaces. Protected surfaces SHALL NOT mount extension Webviews, execute host content scripts, render extension-supplied HTML, or expose consent controls through the ordinary workbench DOM.

#### Scenario: Direct DOM extension is active during permission review
- **WHEN** Kun opens a protected permission or credential window for that extension
- **THEN** no extension content script or extension Webview SHALL execute in that window

#### Scenario: Extension supplies consent copy
- **WHEN** a manifest contains a label or description used in a protected review
- **THEN** the protected surface SHALL render it as untrusted sanitized text alongside host-authored risk disclosure

### Requirement: Sensitive consent is authorized by host-issued operation tokens
After a real user decision in a protected surface, the main process SHALL authorize the pending operation with a short-lived, single-use consent token bound to the extension principal and version, operation kind, parameter digest, workspace, protected window session, and expiry. The token SHALL remain inside trusted host components and SHALL be rejected when forged, replayed, expired, or used for different parameters.

#### Scenario: DOM mutation simulates an approval click
- **WHEN** an extension changes ordinary workbench DOM or emits a synthetic click resembling an approval action
- **THEN** no sensitive operation SHALL proceed because no matching protected-surface consent token exists

#### Scenario: Authorized operation parameters change
- **WHEN** an operation attempts to reuse a valid consent result with a different account, permission, command, tool call, or workspace
- **THEN** the broker SHALL reject the token-to-operation mismatch and require a new protected decision

### Requirement: Extensions are isolated from each other's contributions
An extension SHALL NOT read or mutate another extension's view state, resources, private commands, Webview session, content-script world, or contribution registration. Cross-extension interaction SHALL require a separately documented public command or data contract and normal permission checks.

#### Scenario: Extension requests another view's state
- **WHEN** one extension calls the view state API with another extension's fully qualified contribution ID
- **THEN** the broker SHALL reject the request using the authenticated caller identity

### Requirement: Contribution failures are attributable and non-sensitive
Validation, activation, view, command, and content-script failures SHALL be recorded with extension ID, extension version, contribution ID, workspace scope, and a stable error code. User-visible recovery SHALL identify the responsible extension, while logs and UI SHALL redact secrets, consent tokens, runtime credentials, and unbounded guest payloads.

#### Scenario: Extension command throws an error
- **WHEN** an extension command fails during a user action
- **THEN** Kun SHALL show a bounded extension-attributed failure and record a redacted diagnostic without exposing other extension or runtime data

### Requirement: Only documented workbench contracts are stable
The stable workbench Extension API SHALL consist only of negotiated manifest contribution schemas, public command and context contracts, the Webview bridge, documented theme and state APIs, and the isolated content-script bridge. Electron IPC channel names, renderer stores, React components, `window.kunGui`, internal HTTP tokens, and raw DOM SHALL NOT be public extension contracts.

#### Scenario: Extension imports a Kun renderer module
- **WHEN** an extension depends on an internal renderer path or private IPC channel not present in the public SDK
- **THEN** validation and compatibility tooling SHALL provide no stability guarantee, and Kun SHALL NOT expose that dependency through the extension bridge
