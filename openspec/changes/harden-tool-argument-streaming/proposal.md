## Why

Kun currently rejects legitimate streamed tool calls after 1,024 non-empty argument fragments even when the accumulated JSON is far below the existing byte ceilings. Complex Design and SVG operations routinely produce token-sized argument deltas, so both Chat Completions and Responses providers can fail before the tool is executed.

## What Changes

- Make model-stream protection byte-led while keeping fragment bookkeeping bounded through periodic compaction.
- Retain hard limits for response bytes, argument bytes, pending calls, and completed calls without treating provider chunk granularity as a business payload limit.
- Improve stream-limit diagnostics with safe counters and pending tool identity.
- Coalesce provider text/reasoning deltas before durable event recording so provider chunking does not amplify disk I/O or replay volume.
- Make SSE delimiter detection incremental so unterminated small chunks cannot trigger quadratic rescanning.
- Apply cumulative stream budgets consistently to extension model providers and delegated Claude Agent SDK turns.
- Bound extension-agent replay/live buffers and LLM debug capture by bytes as well as item count.
- Store tool-argument blocks without repeatedly copying all previously accumulated argument text.
- Give Design canvas and SVG mutation tools explicit, enforceable batch and structural-complexity limits.
- Add protocol-level and tool-contract regression coverage for large, highly fragmented legitimate calls and oversized design batches.

## Capabilities

### New Capabilities

- `bounded-tool-argument-streaming`: Safely accepts legitimate highly fragmented tool arguments while bounding retained memory and reporting actionable limit diagnostics.
- `bounded-design-tool-batches`: Defines predictable batch and nested-structure limits for Design canvas and SVG mutation tools.

### Modified Capabilities

None.

## Impact

- Model streaming adapters and shared stream-resource accounting under `kun/src/adapters/model/`.
- Native model-round event emission, Claude Agent SDK runtime/mapper, extension-provider streams, extension-agent replay, and LLM debug recording.
- Design canvas and structured SVG tool schemas and validators under `kun/src/adapters/tool/`.
- Kun model-stream and design-tool unit tests.
- No renderer, preload, IPC, HTTP API, persisted-data, or provider configuration migration is required.
