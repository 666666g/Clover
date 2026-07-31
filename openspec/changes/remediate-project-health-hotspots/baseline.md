# Health Remediation Baseline

Recorded on 2026-07-11 from the live shared `develop` worktree.

## Validation baseline

| Check | Result | Attribution |
| --- | --- | --- |
| `npm --prefix kun run typecheck` | pass | clean baseline |
| `npm --prefix kun run build` | pass | clean baseline |
| `npm --prefix kun test` | 1480/1482 pass | one timing-sensitive file-mutation queue test; one concurrent Google Design expectation mismatch |
| `npm run typecheck` | pass | clean baseline |
| `npm test -- --run` | 3496/3514 pass | 17 concurrent Google Design/provider-default expectation changes; one Claw default-policy expectation |
| `npm run build` | fail in renderer bundle | concurrent `@google/design.md` Node-only linter imported into browser graph |

The failing files are owned by active changes present before this remediation and
are not evidence of hotspot extraction regressions. Every remediation increment
must retain both passing typechecks/builds and compare focused tests against this
baseline until concurrent work restores the full suite.

## Compatibility surface

- Public runtime boundary: Renderer `window.kunGui.runtimeRequest/startSse` -> main
  runtime adapter -> `kun serve` HTTP/SSE.
- Public Kun routes: health, threads/list/search/archive/delete, turns, events,
  fork, resume-thread, approvals, user-inputs, usage, and workspace status.
- Public loop/runtime imports include `AgentLoop`, runtime factory entry points,
  model/tool/thread/session ports, and existing main-process Kun process functions.
- Persisted data: thread metadata/index SQLite, session/items/events JSONL, legacy
  thread JSON, settings JSON, attachment/artifact/memory files, and usage events.
- Provider wire families: OpenAI Chat Completions, OpenAI Responses, Anthropic
  Messages, including endpoint URL, headers, body, stream chunks, tool order,
  images, reasoning, usage, cache fields, retry, and sanitized diagnostics.
- Stable model prefix: Kun system prompt, few shots, canonical tool schemas, and
  model-history repair behavior.
- Saved settings: only the current Kun runtime plus provider/model/workflow/IM and
  application settings; legacy runtime keys remain migration-only inputs.

## Initial hotspot sizes

- `src/main/index.ts`: 1,962 lines.
- `src/main/kun-process.ts`: 1,798 lines.
- `src/main/claw-runtime.ts`: 3,515 lines.
- `kun/src/adapters/model/compat-model-client.ts`: 3,348 lines.
- `src/renderer/src/store/chat-store-runtime.ts`: 1,495 lines.
- `src/renderer/src/agent/kun-mapper.ts`: 1,460 lines.
- `src/main/workflow-runtime.ts`: 2,335 lines.
- `src/renderer/src/components/workflow/NodeConfigPanel.tsx`: 2,377 lines.
- `kun/src/adapters/hybrid/hybrid-thread-store.ts`: 1,382 lines.
- `src/renderer/src/components/chat/FloatingComposer.tsx`: 2,765 lines.
- `src/renderer/src/components/chat/SidebarProjectsSection.tsx`: 2,312 lines.

Line count is an observation, not the completion criterion. Completion requires
one state owner per domain, removal of duplicated active paths, characterization
coverage, and compatibility evidence.

## Model protocol characterization matrix

| Family | Request/header evidence | Stream/tool evidence | Usage evidence |
| --- | --- | --- | --- |
| Chat Completions | endpoint-format and custom-full-endpoint tests capture URL/body/auth/tool ordering | streaming-tool-calls tests cover fragmented calls, finish reasons, truncation, CRLF, limits | native DeepSeek hit/miss case in `compat-usage-normalizer.test.ts` |
| OpenAI Responses | Codex Responses Lite test captures internal header, developer instructions, tools, reasoning, and input | shared streaming tests cover Responses fragmented calls and argument limits | `input_tokens_details.cached_tokens` characterization |
| Anthropic Messages | per-model endpoint/header test captures `/messages`, `x-api-key`, version, max tokens, and image/tool-result layout | streaming tests cover interrupted `tool_use` recovery and common limits | cache read/write plus exclusive `input_tokens` characterization |

Retry, HTML challenge diagnostics, credential redaction, and provider guidance are
captured independently so later endpoint-family extraction can compare the wire
transcript without coupling those shared policies to a decoder implementation.
