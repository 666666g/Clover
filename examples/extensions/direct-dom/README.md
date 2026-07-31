# Direct DOM example

This is the exceptional, high-risk alternative to a stable Kun View. Install it
only when the user has explicitly granted `hostDom` for the selected workspace.

`workbench:*` is a declarative Host-surface matcher, not a URL glob. It matches
non-protected workbench surfaces (`workbench:code`, `workbench:design`,
`workbench:write`, and `workbench:connect`). Settings/onboarding and other
protected consent, approval, credential, and account windows never match and
never receive an extension content script.

Electron executes `dist/content/content.js` in a contribution-specific isolated
world. It can read and modify visible DOM, but it has no Node, Electron,
`window.kunGui`, React object, account secret, runtime token, or another
extension's bridge. The only bridge is `window.kunHost`: this example reads its
Host-derived marker/context and reports a bounded diagnostic when the unsupported
selector is absent. Direct network and popup primitives are disabled.

The example marks its root, avoids overlays and interactive controls, exits when
the target is missing, and removes its node on Host deactivation/page teardown.
`documentEnd` means it never runs before `DOMContentLoaded`; `documentStart`
would instead be armed by preload for the next document and force a safe reload
when first enabled too late. The selectors and
host layout are unsupported compatibility dependencies: Kun may change them in
any patch or minor release. If this behavior can be expressed as a View or
declarative action, delete this example and use the stable contribution instead.
