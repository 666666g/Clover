## 1. Provider Registry And Global Selection

- [x] 1.1 Include the active/default HTTP provider in GUI-managed `serve.providers` and update config/router regression tests.
- [x] 1.2 Persist global composer provider/model selections atomically while preserving thread-local selection behavior.
- [x] 1.3 Normalize unambiguous legacy provider/model mismatches and add shared settings tests.

## 2. Subagent Pair Resolution

- [x] 2.1 Resolve delegated child provider/model values as a coherent pair across explicit, profile, inherited, and default sources.
- [x] 2.2 Add integration coverage for Codex parents with DeepSeek profiles, parent inheritance, and invalid partial overrides.

## 3. Truthful Diagnostics

- [x] 3.1 Make model-client diagnostic lookup non-throwing for unresolved providers.
- [x] 3.2 Report effective turn/child model, provider ID, Base URL, and endpoint format in failure messages with focused tests.

## 4. Cross-Layer Verification

- [x] 4.1 Add regression coverage for Code/Write-style explicit active-provider turns and preserved unknown-provider rejection.
- [x] 4.2 Run focused renderer, main, and Kun tests plus root typecheck and Kun build.
- [x] 4.3 Audit every agent entry point and document any unrelated baseline failures before completion.
