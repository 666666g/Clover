# Kun Extension Developer Documentation

> Extension API: v1 (stable)
> Compatible Kun versions: see [`engines.kun`](./manifest.en.md#version-fields) and the [compatibility matrix](./versioning-and-migrations.en.md#compatibility-matrix)
> 中文：[Kun 扩展开发者文档](./README.md)

A Kun Extension can combine workbench UI, background Node logic, Kun Agent workflows, tools, account authentication, and custom model Providers into one installable `.kunx` application. Extensions use public SDKs and capability brokers. They do not receive Kun's internal `AgentLoop`, runtime bearer token, private Electron IPC, or the complete `window.kunGui` bridge.

Kun always has one Agent runtime: `kun serve`. Extension-to-Agent calls and Kun-to-extension tool or Provider calls share that runtime's threads, approvals, tools, events, and usage accounting. A Node extension can be activated by `kun serve` or supported CLI paths without the desktop GUI.

## Choose the right integration mechanism

| Need | Use | Executes code | Lifecycle |
| --- | --- | --- | --- |
| Workbench app, background service, Agent workflow, or complete model Provider | Kun Extension (these guides) | Yes, according to entries and disclosed permissions | Extension Host / Webview |
| Appearance, icon, or visual resources only | UI appearance pack | No | Existing UI Plugin flow |
| Expose an external tool service to the Agent | MCP Server | The MCP service executes code | Existing MCP flow |
| Reusable prompts, instructions, and working methods | Skill | Normally no extension code | Existing Skill flow |

These systems remain independent. Installing a `.kunx` does not migrate appearance packs, MCP configuration, or Skills, and extensions should not copy them into private replacement formats.

## Recommended learning path

1. Read [Architecture and boundaries](./architecture.en.md) to understand the Node Host, Webviews, brokers, and the single Kun runtime.
2. Follow the [five-minute quick start](./quick-start.en.md) to create, test, package, and side-load a right-sidebar extension.
3. Use the [Manifest reference](./manifest.en.md) to declare entries, contributions, activation events, permissions, and versions, then choose stable SDK exports from the [API reference](./api-reference.en.md).
4. Use [Activation and lifecycle](./lifecycle.en.md) to register and dispose resources correctly.
5. Continue with the workbench, Agent/tool, Provider/account, or resource guides that match the extension.
6. Complete the [release checklist](./release-troubleshooting-changelog.en.md#release-checklist) before publishing.

## Guide index

### Foundations

- [Architecture and boundaries](./architecture.en.md)
- [Five-minute quick start](./quick-start.en.md)
- [Manifest reference](./manifest.en.md)
- [Extension API reference](./api-reference.en.md)
- [Activation and lifecycle](./lifecycle.en.md)

### UI and workbench

- [Workbench contributions, commands, settings, and UX](./workbench.en.md)
- [Webviews and Direct DOM](./webview-and-dom.en.md)

### Kun capabilities

- [Agent Runs and tools](./agent-and-tools.en.md)
- [Model Providers, accounts, and authentication](./providers-and-accounts.en.md)
- [Permissions, trust, storage, network, logs, and quotas](./security-and-resources.en.md)

### Distribution and maintenance

- [Packaging, side-loading, and custom indexes](./packaging-and-index.en.md)
- [CLI, testing, and debugging](./cli-testing-debugging.en.md)
- [Versioning, compatibility, and state migration](./versioning-and-migrations.en.md)
- [Release, troubleshooting, and API changelog](./release-troubleshooting-changelog.en.md)

## Stability boundary

The stable surface consists only of:

- public exports from `@kun/extension-api`;
- public exports from `@kun/extension-react` and `@kun/extension-test`;
- published Manifest and contribution JSON Schemas;
- Host Context, Webview bridge, command, context-key, theme, locale, and state APIs;
- documented Agent, tool, Provider, account, authentication, storage, and network contracts;
- documented CLI commands, structured output, and diagnostic codes.

Unstable surfaces that are not protected by SemVer include host DOM, CSS classes, React structure, renderer stores, Electron IPC names, Kun internal HTTP/RPC, `window.kunGui`, and unexported source paths. In particular, selectors used by `hostContentScripts` may change in a Kun patch or minor release. Prefer stable contribution points and Webviews whenever possible.

## Important trust notices

- A Node `main` entry runs with the current operating-system user's privileges. A dedicated process provides fault and resource isolation, not a malicious-code security sandbox.
- Webviews have Node disabled, context isolation and Chromium sandboxing enabled, and direct network access blocked by default. Use the network broker.
- Direct DOM can read and modify visible workbench content and is a high-risk, unstable capability.
- A model Provider receives the complete model-visible request, including conversation history, instructions, attachments, and tool schemas.
- Webviews and content scripts never receive raw account secrets. A Node extension can request a minimally scoped secret only after declaring and receiving approval for the dedicated secret-read permission.

Install Node or Direct DOM extensions only from sources you trust. A signature is provenance evidence, not a security audit. Unsigned packages may be side-loaded, but Kun records their source, digest, and permission consent.

## Documentation and schema authority

The Chinese files are the normative behavioral source; matching `.en.md` files are the English versions. For Manifest and public wire payload field names, requiredness, and formats, the same-version generated JSON Schema and TypeScript types are the machine-enforced source of truth. If an example and schema disagree, confirm with `kun extension validate` and report the drift as a documentation defect.

## Machine-readable references

- [Manifest JSON Schema](../../packages/extension-api/schema/kun-extension.schema.json)
- [Generated Extension API reference and export snapshots](./api-reference.en.md)
- [`@kun/extension-api` export entry](../../packages/extension-api/src/index.ts)
- [`@kun/extension-react` export entry](../../packages/extension-react/src/index.tsx)
- [`@kun/extension-test` export entry](../../packages/extension-test/src/index.ts)
- [Six runnable examples](../../examples/extensions/README.md)

Release-generated `.d.ts` files are the type source of truth; the standalone API reference in this directory derives from public module symbols and in-memory declaration snapshots. CI checks Schema drift, bilingual heading/code-block structure, JSON/TypeScript snippets, links/anchors, SDK export/type fingerprints, and Changelog alignment, then exercises example typecheck/build/browser artifacts/Manifest/headless smoke coverage.
