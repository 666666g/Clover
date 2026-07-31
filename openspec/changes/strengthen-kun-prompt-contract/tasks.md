## 1. Prompt Contract

- [x] 1.1 Rewrite `KUN_SYSTEM_PROMPT` as the capability-agnostic stable operating contract and remove mutable/tool-specific/runtime-internal guidance.
- [x] 1.2 Add prompt helpers for thread-profile envelopes, labeled turn-context blocks, and capability-aware tool guidance.
- [x] 1.3 Add focused prompt-helper tests for required stable sections, volatile-content exclusion, metadata escaping, content preservation, and catalog-specific guidance.

## 2. Request Orchestration

- [x] 2.1 Add `threadProfileInstruction` to the internal model request and estimator, keeping `systemPrompt` verbatim from `ImmutablePrefix`.
- [x] 2.2 Project stable prompt, thread profile, mode, history, and turn context in the specified order and update request/projector tests.
- [x] 2.3 Convert native model-step dynamic inputs into ordered `kind`/`authority` context blocks without changing their source bodies or tool-catalog ordering.

## 3. Verification

- [x] 3.1 Run the focused Kun prompt, request-composer, projector, and model-step/agent-loop tests and fix any regressions.
- [x] 3.2 Run `npm run typecheck`, `npm run build:kun`, and `git diff --check`, separating any unrelated baseline failures.
- [x] 3.3 Review the final diff against the OpenSpec scenarios and document the Claude Code design findings and Kun-specific trade-offs in the handoff.
