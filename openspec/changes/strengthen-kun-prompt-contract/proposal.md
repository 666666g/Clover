## Why

Kun already protects a byte-stable model prefix, but its prompt spends substantial space describing Kun's internal GUI/runtime architecture while leaving important agent behaviors implicit. Comparing the restored Claude Code prompt pipeline shows an opportunity to make Kun more reliable by separating durable behavior, capability-dependent guidance, and per-turn context with explicit trust and precedence boundaries.

## What Changes

- Replace the current stable Kun system prompt with a concise, product-appropriate operating contract covering instruction precedence, trustworthy completion, scoped implementation, safe actions, tool discipline, context continuity, and user communication.
- Keep runtime, workspace, model, time, tool availability, memory, Skill, AGENTS.md, and extension data outside the immutable prefix.
- Generate capability-aware per-turn tool guidance for dedicated inspection/edit/search/shell/verification/task tools, including parallel execution of independent reads and diagnosis before retries.
- Wrap thread profiles and dynamic context in explicit Kun-owned envelopes that state source, precedence, relevance, and trust without changing the underlying content.
- Add focused prompt-contract and request-projection tests that guard section ordering, volatile-content exclusion, profile precedence, dynamic-context placement, and tool-guidance selection.

## Capabilities

### New Capabilities

- `kun-prompt-orchestration`: Defines Kun's stable agent operating contract and the rules for composing capability-aware, trust-labeled dynamic prompt context.

### Modified Capabilities

None.

## Impact

- Affected code is limited to `kun/src/prompt`, native model-request composition/projection under `kun/src/loop` and `kun/src/adapters/model`, and adjacent Vitest coverage.
- The Kun HTTP/SSE surface, renderer contracts, provider request formats, tool schemas, approval policy, and sandbox behavior remain unchanged.
- The immutable prefix fingerprint intentionally changes once when this version ships; subsequent turns retain byte stability.
